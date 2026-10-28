import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { OzonMarketplaceAdapter } from '../../src/modules/ozon/ozon-marketplace.adapter';
import {
  OZON_POSTING_STAGE,
  OZON_POSTING_STATUSES,
  ozonMarketplaceOrder,
  ozonPostingStage,
} from '../../src/modules/ozon/ozon-orders';
import {
  OzonOrdersService,
  ozonWindows,
  windowMoments,
} from '../../src/modules/ozon/ozon-orders.service';
import { OzonNotConnectedError } from '../../src/modules/ozon/ozon-seller-client';
import {
  OZON_FBO_POSTINGS_LIMIT,
  OZON_FBS_POSTINGS_LIMIT,
  OZON_PATHS,
  OzonSellerClient,
  mapPostingsPage,
} from '../../src/modules/ozon/ozon.client';
import { ORDER_STAGES } from '../../src/shared/order-stage';

const API_KEY = 'aaaaaaaa-SECRET-bbbb-cccc-0123456789ab';
const NOW = new Date('2026-10-18T09:00:00Z');

/** axios.create → фейк, отвечающий по пути (образец ozon-catalog.test.ts). */
function stubRoutes(routes: Record<string, (body: any) => unknown>) {
  const calls: Array<{ path: string; body: any }> = [];
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        post: async (path: string, body: any) => {
          calls.push({ path, body });
          return { data: await routes[path](body) };
        },
      }) as never,
  );
  return calls;
}

const client = () =>
  new OzonSellerClient(
    'https://api-seller.ozon.ru',
    { clientId: '1', apiKey: API_KEY },
    { sleep: async () => undefined },
  );

const raw = (n: number, status = 'awaiting_packaging', extra: Record<string, unknown> = {}) => ({
  posting_number: `P-${n}`,
  order_number: `O-${n}`,
  status,
  substatus: 'posting_created',
  in_process_at: '2026-10-17T21:30:00Z',
  products: [
    { offer_id: 'A', name: 'Часы', quantity: 2, price: { amount: '1990.50', currency: 'RUB' } },
  ],
  ...extra,
});

describe('статусы отправлений Ozon → этапы ТЗ', () => {
  it('таблица покрывает полный перечень и ведёт только в этапы общего набора', () => {
    expect(Object.keys(OZON_POSTING_STAGE).sort()).toEqual([...OZON_POSTING_STATUSES].sort());
    for (const stage of Object.values(OZON_POSTING_STAGE)) expect(ORDER_STAGES).toContain(stage);
  });

  it('ключевые решения: собран, передан, выкуплен; незнакомое — unknown, а не догадка', () => {
    expect(ozonPostingStage('awaiting_packaging')).toBe('awaiting_assembly');
    expect(ozonPostingStage('awaiting_deliver')).toBe('assembled');
    expect(ozonPostingStage('driver_pickup')).toBe('handed_over');
    expect(ozonPostingStage('delivering')).toBe('in_transit');
    expect(ozonPostingStage('delivered')).toBe('redeemed');
    expect(ozonPostingStage('cancelled')).toBe('cancelled');
    expect(ozonPostingStage('teleported')).toBe('unknown');
    expect(ozonPostingStage('')).toBe('unknown');
  });
});

describe('разбор отправлений', () => {
  it('страница FBS v4 / FBO v3: плоские postings, cursor и has_next; мусор отброшен', () => {
    const page = mapPostingsPage({
      postings: [raw(1), null, { status: 'x' }],
      cursor: 'c1',
      has_next: true,
    });
    expect(page.hasNext).toBe(true);
    expect(page.cursor).toBe('c1');
    expect(page.postings).toEqual([
      {
        postingNumber: 'P-1',
        orderNumber: 'O-1',
        status: 'awaiting_packaging',
        substatus: 'posting_created',
        inProcessAt: '2026-10-17T21:30:00Z',
        products: [{ offerId: 'A', name: 'Часы', quantity: 2, price: 1990.5, currency: 'RUB' }],
      },
    ]);
    expect(mapPostingsPage(null)).toEqual({ postings: [], hasNext: false, cursor: '' });
    // Старый конверт `result` снятых методов — не наш ответ: пусто, а не догадка.
    expect(mapPostingsPage({ result: { postings: [raw(2)] } }).postings).toEqual([]);
  });

  it('отправление → заказ: день по Москве, продажи — Σ цена × штуки, не рубли — null', () => {
    const [posting] = mapPostingsPage({ postings: [raw(1)] }).postings;
    expect(ozonMarketplaceOrder(posting, 'FBS')).toEqual({
      marketplace: 'ozon',
      id: 'P-1',
      orderNumber: 'O-1',
      scheme: 'FBS',
      stage: 'awaiting_assembly',
      status: 'awaiting_packaging',
      substatus: 'posting_created',
      // 21:30Z 17-го — это 00:30 18-го по Москве.
      createdDay: '2026-10-18',
      items: [{ sku: 'A', name: 'Часы', count: 2, price: 1990.5 }],
      sales: 3981,
    });
    const usd = {
      ...posting,
      products: [{ offerId: 'B', quantity: 1, price: 10, currency: 'USD' }],
    };
    expect(ozonMarketplaceOrder(usd, 'FBO').sales).toBeNull();
    expect(ozonMarketplaceOrder(usd, 'FBO').items[0].price).toBeNull();
  });
});

describe('OzonSellerClient: обход отправлений', () => {
  afterEach(() => vi.restoreAllMocks());

  it('FBS — по курсору до has_next: false, период в UTC', async () => {
    const calls = stubRoutes({
      [OZON_PATHS.fbsPostings]: (body) =>
        body.cursor
          ? { postings: [raw(2)], cursor: '', has_next: false }
          : { postings: [raw(1)], cursor: 'next', has_next: true },
    });
    const since = new Date('2026-10-01T00:00:00+03:00');
    const to = new Date('2026-10-18T23:59:59+03:00');
    const postings = await client().listFbsPostings(since, to);
    expect(postings.map((p) => p.postingNumber)).toEqual(['P-1', 'P-2']);
    expect(OZON_PATHS.fbsPostings).toBe('/v4/posting/fbs/list');
    expect(calls[0].body).toEqual({
      sort_dir: 'ASC',
      filter: { since: '2026-09-30T21:00:00.000Z', to: '2026-10-18T20:59:59.000Z' },
      limit: OZON_FBS_POSTINGS_LIMIT,
      cursor: '',
    });
    expect(calls[1].body.cursor).toBe('next');
    expect(OZON_FBS_POSTINGS_LIMIT).toBe(100);
  });

  it('FBO — тем же контрактом v3', async () => {
    const calls = stubRoutes({
      [OZON_PATHS.fboPostings]: (body) =>
        body.cursor
          ? { postings: [raw(9, 'delivered')], has_next: false }
          : { postings: [raw(8, 'delivered')], cursor: 'c', has_next: true },
    });
    const postings = await client().listFboPostings(NOW, NOW);
    expect(OZON_PATHS.fboPostings).toBe('/v3/posting/fbo/list');
    expect(postings.map((p) => p.postingNumber)).toEqual(['P-8', 'P-9']);
    expect(calls.map((c) => c.body.cursor)).toEqual(['', 'c']);
    expect(calls[0].body.limit).toBe(OZON_FBO_POSTINGS_LIMIT);
  });

  it('тот же курсор по кругу — ошибка, а не обрезанный список', async () => {
    stubRoutes({
      [OZON_PATHS.fbsPostings]: () => ({ postings: [raw(1)], cursor: 'loop', has_next: true }),
    });
    await expect(client().listFbsPostings(NOW, NOW)).rejects.toThrow('тот же курсор');
  });
});

describe('OzonOrdersService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function service(fbs: unknown[][], fbo: unknown[][] = fbs.map(() => [])) {
    let fbsCall = 0;
    let fboCall = 0;
    const api = {
      listFbsPostings: vi.fn(async () => mapPostingsPage({ postings: fbs[fbsCall++] }).postings),
      listFboPostings: vi.fn(async () => mapPostingsPage({ postings: fbo[fboCall++] }).postings),
    };
    const credentialsOf = vi.fn(async () => ({ clientId: '1', apiKey: API_KEY }));
    return {
      api,
      credentialsOf,
      instance: new OzonOrdersService(
        { forCredentials: () => api } as never,
        { credentialsOf } as never,
      ),
    };
  }

  it('FBS и FBO вместе; отменённые отдельно; дубль на границе окон — один раз', async () => {
    const { instance, api } = service(
      [[raw(1), raw(2, 'cancelled')], [raw(1)]],
      [[raw(3, 'delivered')], []],
    );
    // 31-е число: «с 1 числа» — два окна.
    const now = new Date('2026-10-31T09:00:00Z');
    const result = await instance.listOrders('111', { key: 'month' } as never, now);
    expect(api.listFbsPostings).toHaveBeenCalledTimes(2);
    expect(result.orders.map((o) => `${o.id}:${o.scheme}`)).toEqual(['P-1:FBS', 'P-3:FBO']);
    expect(result.cancelled.map((o) => o.id)).toEqual(['P-2']);
  });

  it('незнакомый статус — заказ с этапом unknown и предупреждение в лог', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { instance } = service([[raw(1, 'teleported')]]);
    const result = await instance.listOrders('111', { key: 'today' } as never, NOW);
    expect(result.orders[0].stage).toBe('unknown');
    expect(warn.mock.calls.flat().join(' ')).toContain('teleported');
  });

  it('нет ключа — OzonNotConnectedError, Ozon не спрашивается', async () => {
    const forCredentials = vi.fn();
    const instance = new OzonOrdersService(
      { forCredentials } as never,
      { credentialsOf: async () => null } as never,
    );
    await expect(instance.listOrders('111', { key: 'today' } as never)).rejects.toBeInstanceOf(
      OzonNotConnectedError,
    );
    expect(forCredentials).not.toHaveBeenCalled();
  });

  it('«Всего» — последние 30 московских дней; окно — с 00:00 по 23:59:59 МСК', () => {
    const [window] = ozonWindows({ key: 'all' } as never, NOW);
    expect(window).toMatchObject({
      from: { year: 2026, month: 9, day: 19 },
      to: { year: 2026, month: 10, day: 18 },
    });
    const { since, to } = windowMoments(window, NOW);
    expect(since.toISOString()).toBe('2026-09-18T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-18T20:59:59.000Z');
  });
});

describe('OzonMarketplaceAdapter: заказы', () => {
  it('делегирует сервису; нет ключа — отказ реестра', async () => {
    const placed = { orders: [], cancelled: [] };
    const listOrders = vi.fn(async () => placed);
    const ok = new OzonMarketplaceAdapter(
      {} as never,
      {} as never,
      {} as never,
      { listOrders } as never,
    );
    const ref = { telegramUserId: '111', marketplace: 'ozon' as const };
    expect(await ok.orders.listOrders(ref, { key: 'today' } as never, NOW)).toBe(placed);
    expect(listOrders).toHaveBeenCalledWith('111', { key: 'today' }, NOW);

    const missing = new OzonMarketplaceAdapter(
      {} as never,
      {} as never,
      {} as never,
      {
        listOrders: async () => {
          throw new OzonNotConnectedError('111');
        },
      } as never,
    );
    await expect(missing.orders.listOrders(ref, { key: 'today' } as never)).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
  });
});
