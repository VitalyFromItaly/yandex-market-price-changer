import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { WbMarketplaceAdapter } from '../../src/modules/wb/wb-marketplace.adapter';
import {
  WB_STATUSES,
  WB_STATUS_STAGE,
  WB_SUPPLIER_STATUSES,
  WB_SUPPLIER_STATUS_STAGE,
  wbFbsStage,
  wbMarketplaceOrder,
  wbOrderStage,
  wbScheme,
} from '../../src/modules/wb/wb-orders';
import { WbOrdersService } from '../../src/modules/wb/wb-orders.service';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { WbStatisticsPacer } from '../../src/modules/wb/wb-statistics-pacer';
import { WbIncompleteResponseError } from '../../src/modules/wb/wb.errors';
import {
  WB_CATEGORY_HOSTS,
  WB_FBS_ORDERS_LIMIT,
  WB_PATHS,
  WB_STATISTICS_INTERVAL_MS,
  WB_STATISTICS_MAX_PAGES,
  WB_STATISTICS_PAGE_ROWS,
  WbClient,
  mapFbsOrderStatuses,
  mapFbsOrders,
  mapWbOrders,
  mapWbSales,
} from '../../src/modules/wb/wb.client';
import { ORDER_STAGES } from '../../src/shared/order-stage';

const TOKEN = 'header.payload.SECRETsignatureSECRET0123456789abcdef';
const NOW = new Date('2026-10-18T09:00:00Z');

const ORDERS_URL = `${WB_CATEGORY_HOSTS.statistics}${WB_PATHS.supplierOrders}`;
const SALES_URL = `${WB_CATEGORY_HOSTS.statistics}${WB_PATHS.supplierSales}`;
const FBS_URL = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.fbsOrders}`;
const STATUS_URL = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.fbsOrderStatuses}`;

/** axios.create → фейк, отвечающий по полному адресу (образец wb-catalog.test.ts). */
function stubRoutes(routes: Record<string, (body: any, config?: any) => unknown>) {
  const calls: Array<{ method: string; url: string; body?: any; config?: any }> = [];
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        get: async (url: string, config?: any) => {
          calls.push({ method: 'get', url, config });
          return { data: await routes[url](undefined, config) };
        },
        post: async (url: string, body: any) => {
          calls.push({ method: 'post', url, body });
          return { data: await routes[url](body) };
        },
      }) as never,
  );
  return calls;
}

const order = (srid: string, extra: Record<string, unknown> = {}) => ({
  srid,
  gNumber: `G-${srid}`,
  date: '2026-10-17T23:30:00',
  lastChangeDate: '2026-10-17T23:40:00',
  supplierArticle: 'A-1',
  nmId: 777,
  subject: 'Часы',
  warehouseType: 'Склад WB',
  priceWithDisc: 1990.5,
  isCancel: false,
  ...extra,
});

describe('статусы WB → этапы ТЗ', () => {
  it('таблицы покрывают полные перечни и ведут только в этапы общего набора', () => {
    expect(Object.keys(WB_SUPPLIER_STATUS_STAGE).sort()).toEqual([...WB_SUPPLIER_STATUSES].sort());
    expect(Object.keys(WB_STATUS_STAGE).sort()).toEqual([...WB_STATUSES].sort());
    for (const stage of [
      ...Object.values(WB_SUPPLIER_STATUS_STAGE),
      ...Object.values(WB_STATUS_STAGE).filter(Boolean),
    ]) {
      expect(ORDER_STAGES).toContain(stage);
    }
  });

  it('FBS: waiting — по статусу продавца; отказ покупателя отличается от отмены; незнакомое — unknown', () => {
    expect(wbFbsStage({ supplierStatus: 'new', wbStatus: 'waiting' })).toBe('new');
    expect(wbFbsStage({ supplierStatus: 'confirm', wbStatus: 'waiting' })).toBe(
      'awaiting_assembly',
    );
    expect(wbFbsStage({ supplierStatus: 'complete', wbStatus: 'sorted' })).toBe('in_transit');
    expect(wbFbsStage({ supplierStatus: 'complete', wbStatus: 'ready_for_pickup' })).toBe(
      'delivered',
    );
    expect(wbFbsStage({ supplierStatus: 'complete', wbStatus: 'sold' })).toBe('redeemed');
    expect(wbFbsStage({ supplierStatus: 'complete', wbStatus: 'declined_by_client' })).toBe(
      'returning',
    );
    expect(wbFbsStage({ supplierStatus: 'complete', wbStatus: 'canceled_by_client' })).toBe(
      'cancelled',
    );
    expect(wbFbsStage({ supplierStatus: 'complete', wbStatus: 'teleported' })).toBe('unknown');
    expect(wbFbsStage({ supplierStatus: 'teleported', wbStatus: 'waiting' })).toBe('unknown');
    expect(wbFbsStage({ supplierStatus: '', wbStatus: '' })).toBe('unknown');
  });

  it('приоритет: возврат > выкуп > статус FBS > отмена > FBW «в пути»', () => {
    const base = mapWbOrders([order('1')]).rows[0];
    const sale = (saleID: string) => ({ srid: '1', saleID, lastChangeDate: '' });
    const fbsStatus = { id: '9', supplierStatus: 'complete', wbStatus: 'declined_by_client' };
    expect(wbOrderStage({ srid: '1', order: base, sale: sale('R123'), fbsStatus }).stage).toBe(
      'returned',
    );
    expect(wbOrderStage({ srid: '1', order: base, sale: sale('S123'), fbsStatus }).stage).toBe(
      'redeemed',
    );
    expect(wbOrderStage({ srid: '1', order: { ...base, isCancel: true }, fbsStatus })).toEqual({
      stage: 'returning',
      status: 'complete',
      substatus: 'declined_by_client',
    });
    expect(wbOrderStage({ srid: '1', order: { ...base, isCancel: true } }).stage).toBe('cancelled');
    expect(wbOrderStage({ srid: '1', order: base })).toEqual({
      stage: 'in_transit',
      status: 'ordered',
      substatus: null,
    });
  });

  it('схема по типу склада', () => {
    expect(wbScheme('Склад WB')).toBe('FBW');
    expect(wbScheme('Склад продавца')).toBe('FBS');
    expect(wbScheme('')).toBeNull();
  });
});

describe('разбор ответов', () => {
  it('заказы и продажи: мусор отброшен, count — до отсева', () => {
    const orders = mapWbOrders([order('1'), null, { gNumber: 'без srid' }]);
    expect(orders.count).toBe(2);
    expect(orders.rows).toEqual([
      {
        srid: '1',
        gNumber: 'G-1',
        date: '2026-10-17T23:30:00',
        lastChangeDate: '2026-10-17T23:40:00',
        supplierArticle: 'A-1',
        nmId: '777',
        subject: 'Часы',
        warehouseType: 'Склад WB',
        priceWithDisc: 1990.5,
        isCancel: false,
      },
    ]);
    expect(mapWbOrders([order('2', { priceWithDisc: 'мусор' })]).rows[0].priceWithDisc).toBeNull();
    expect(mapWbOrders({}).rows).toEqual([]);
    expect(mapWbSales([{ srid: '1', saleID: 'S1' }, { srid: '2' }]).rows).toHaveLength(1);
  });

  it('FBS: цена из копеек только в рублях; статусы', () => {
    const fbs = mapFbsOrders({
      next: 5,
      orders: [
        {
          id: 1,
          rid: 'r1',
          createdAt: '2026-10-17T21:30:00Z',
          article: 'A',
          convertedPrice: 199050,
          convertedCurrencyCode: 643,
        },
        { id: 2, rid: 'r2', convertedPrice: 100, convertedCurrencyCode: 933 },
        { rid: 'без id' },
      ],
    });
    expect(fbs.next).toBe(5);
    expect(fbs.count).toBe(3);
    expect(fbs.orders.map((o) => o.price)).toEqual([1990.5, null]);
    expect(
      mapFbsOrderStatuses({ orders: [{ id: 1, supplierStatus: 'new', wbStatus: 'waiting' }] }),
    ).toEqual([{ id: '1', supplierStatus: 'new', wbStatus: 'waiting' }]);
  });

  it('штука → заказ: srid, корзина, день по Москве, продажи до СПП', () => {
    expect(wbMarketplaceOrder({ srid: '1', order: mapWbOrders([order('1')]).rows[0] })).toEqual({
      marketplace: 'wb',
      id: '1',
      orderNumber: 'G-1',
      scheme: 'FBW',
      stage: 'in_transit',
      status: 'ordered',
      substatus: null,
      // Дата статистики — уже московская, без смещения.
      createdDay: '2026-10-17',
      items: [{ sku: 'A-1', name: 'Часы', count: 1, price: 1990.5 }],
      sales: 1990.5,
    });
  });
});

describe('WbClient: обход по lastChangeDate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('полная страница — следующая с lastChangeDate последней строки; пауза лимита между вызовами статистики', async () => {
    const full = Array.from({ length: WB_STATISTICS_PAGE_ROWS }, (_, i) =>
      order(`a${i}`, { lastChangeDate: '2026-10-10T10:00:00' }),
    );
    const calls = stubRoutes({
      [ORDERS_URL]: (_b, config) =>
        config.params.dateFrom === '2026-10-01'
          ? full
          : [order('b', { lastChangeDate: '2026-10-11T00:00:00' })],
      [SALES_URL]: () => [{ srid: 'b', saleID: 'S1', lastChangeDate: '2026-10-12T00:00:00' }],
    });
    // Часы двигает только пауза — интервал виден целиком, а не «минус миллисекунды теста».
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const client = new WbClient(TOKEN, { sleep, pacer: new WbStatisticsPacer(() => clock) });
    const rows = await client.listSupplierOrders('2026-10-01');
    expect(rows).toHaveLength(WB_STATISTICS_PAGE_ROWS + 1);
    expect(calls.map((c) => c.config.params)).toEqual([
      { dateFrom: '2026-10-01', flag: 0 },
      { dateFrom: '2026-10-10T10:00:00', flag: 0 },
    ]);
    await client.listSupplierSales('2026-10-01');
    // Перед второй страницей и перед продажами — по интервалу лимита.
    expect(sleep.mock.calls).toEqual([[WB_STATISTICS_INTERVAL_MS], [WB_STATISTICS_INTERVAL_MS]]);
  });

  it('полная страница без сдвига lastChangeDate — ошибка, а не круг и не молчаливый недосчёт', async () => {
    const full = Array.from({ length: WB_STATISTICS_PAGE_ROWS }, (_, i) =>
      order(`a${i}`, { lastChangeDate: '2026-10-01' }),
    );
    const calls = stubRoutes({ [ORDERS_URL]: () => full });
    await expect(
      new WbClient(TOKEN, { sleep: async () => undefined }).listSupplierOrders('2026-10-01'),
    ).rejects.toBeInstanceOf(WbIncompleteResponseError);
    expect(calls).toHaveLength(1);
  });

  it('потолок полных страниц исчерпан — ошибка, а не обрезанный список', async () => {
    // Строки одной страницы общие: обходу важна только дата последней.
    const body = Array.from({ length: WB_STATISTICS_PAGE_ROWS - 1 }, (_, i) => order(`a${i}`));
    let page = 0;
    const calls = stubRoutes({
      [ORDERS_URL]: () => {
        page += 1;
        return [
          ...body,
          order(`last${page}`, {
            lastChangeDate: `2026-10-01T00:${String(page).padStart(2, '0')}:00`,
          }),
        ];
      },
    });
    await expect(
      new WbClient(TOKEN, { sleep: async () => undefined }).listSupplierOrders('2026-09-30'),
    ).rejects.toBeInstanceOf(WbIncompleteResponseError);
    expect(calls).toHaveLength(WB_STATISTICS_MAX_PAGES);
  });

  it('FBS: курсор next до неполной страницы, интервал — unix-секунды; статусы батчами', async () => {
    const calls = stubRoutes({
      [FBS_URL]: (_b, config) => ({
        next: config.params.next + 1,
        orders:
          config.params.next === 0
            ? Array.from({ length: WB_FBS_ORDERS_LIMIT }, (_, i) => ({ id: i + 1, rid: `r${i}` }))
            : [{ id: 5000, rid: 'last' }],
      }),
      [STATUS_URL]: (body) => ({
        orders: body.orders.map((id: number) => ({
          id,
          supplierStatus: 'new',
          wbStatus: 'waiting',
        })),
      }),
    });
    const client = new WbClient(TOKEN, { sleep: async () => undefined });
    const since = new Date('2026-10-01T00:00:00+03:00');
    const orders = await client.listFbsOrders(since, NOW);
    expect(orders).toHaveLength(WB_FBS_ORDERS_LIMIT + 1);
    expect(calls[0].config.params).toEqual({
      limit: WB_FBS_ORDERS_LIMIT,
      next: 0,
      dateFrom: since.getTime() / 1000,
      dateTo: NOW.getTime() / 1000,
    });
    const statuses = await client.fbsOrderStatuses(orders.map((o) => o.id));
    expect(statuses).toHaveLength(WB_FBS_ORDERS_LIMIT + 1);
    expect(calls.filter((c) => c.url === STATUS_URL).map((c) => c.body.orders.length)).toEqual([
      WB_FBS_ORDERS_LIMIT,
      1,
    ]);
  });
});

describe('WbOrdersService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function service(api: Record<string, unknown>) {
    const full = {
      listSupplierOrders: vi.fn(async () => []),
      listSupplierSales: vi.fn(async () => []),
      listFbsOrders: vi.fn(async () => []),
      fbsOrderStatuses: vi.fn(async () => []),
      ...api,
    };
    const credentialsOf = vi.fn(async () => ({ token: TOKEN }));
    return {
      api: full,
      instance: new WbOrdersService({ forToken: () => full } as never, { credentialsOf } as never),
    };
  }

  it('выкуп, возврат, отказ FBS и отмена различимы; чужой период отсечён; дубль стыка — один раз', async () => {
    const rows = mapWbOrders([
      order('s'),
      order('r'),
      order('c', { isCancel: true }),
      order('f', { warehouseType: 'Склад продавца', isCancel: true }),
      order('old', { date: '2026-09-01T10:00:00' }),
      order('s'),
    ]).rows;
    const { instance, api } = service({
      listSupplierOrders: vi.fn(async () => rows),
      listSupplierSales: vi.fn(async () => [
        { srid: 'r', saleID: 'S1', lastChangeDate: '' },
        { srid: 'r', saleID: 'R1', lastChangeDate: '' },
        { srid: 's', saleID: 'S2', lastChangeDate: '' },
        { srid: 'nowhere', saleID: 'S3', lastChangeDate: '' },
      ]),
      listFbsOrders: vi.fn(async () => mapFbsOrders({ orders: [{ id: 9, rid: 'f' }] }).orders),
      fbsOrderStatuses: vi.fn(async () => [
        { id: '9', supplierStatus: 'complete', wbStatus: 'declined_by_client' },
      ]),
    });
    const result = await instance.listOrders('111', { key: 'week' } as never, NOW);
    // Статистика — с первого дня периода, по дате изменения.
    expect(api.listSupplierOrders).toHaveBeenCalledWith('2026-10-12');
    expect(api.listSupplierSales).toHaveBeenCalledWith('2026-10-12');
    expect(result.orders.map((o) => `${o.id}:${o.stage}`)).toEqual([
      's:redeemed',
      'r:returned',
      'f:returning',
    ]);
    expect(result.cancelled.map((o) => o.id)).toEqual(['c']);
  });

  it('незнакомый статус FBS — заказ с этапом unknown и предупреждение в лог', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { instance } = service({
      listFbsOrders: vi.fn(
        async () =>
          mapFbsOrders({ orders: [{ id: 9, rid: 'f', createdAt: '2026-10-18T08:00:00Z' }] }).orders,
      ),
      fbsOrderStatuses: vi.fn(async () => [
        { id: '9', supplierStatus: 'complete', wbStatus: 'teleported' },
      ]),
    });
    const result = await instance.listOrders('111', { key: 'today' } as never, NOW);
    expect(result.orders.map((o) => `${o.id}:${o.scheme}:${o.stage}`)).toEqual(['f:FBS:unknown']);
    expect(warn.mock.calls.flat().join(' ')).toContain('teleported');
  });

  it('нет токена — WbNotConnectedError, клиент не создаётся', async () => {
    const forToken = vi.fn();
    const instance = new WbOrdersService(
      { forToken } as never,
      { credentialsOf: async () => null } as never,
    );
    await expect(instance.listOrders('111', { key: 'today' } as never)).rejects.toBeInstanceOf(
      WbNotConnectedError,
    );
    expect(forToken).not.toHaveBeenCalled();
  });
});

describe('WbMarketplaceAdapter: заказы', () => {
  it('делегирует сервису; нет токена — отказ реестра', async () => {
    const placed = { orders: [], cancelled: [] };
    const listOrders = vi.fn(async () => placed);
    const ref = { telegramUserId: '111', marketplace: 'wb' as const };
    const ok = new WbMarketplaceAdapter(
      {} as never,
      {} as never,
      {} as never,
      {
        listOrders,
      } as never,
    );
    expect(await ok.orders.listOrders(ref, { key: 'today' } as never, NOW)).toBe(placed);
    expect(listOrders).toHaveBeenCalledWith('111', { key: 'today' }, NOW);

    const missing = new WbMarketplaceAdapter(
      {} as never,
      {} as never,
      {} as never,
      {
        listOrders: async () => {
          throw new WbNotConnectedError('111');
        },
      } as never,
    );
    await expect(missing.orders.listOrders(ref, { key: 'today' } as never)).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
  });
});
