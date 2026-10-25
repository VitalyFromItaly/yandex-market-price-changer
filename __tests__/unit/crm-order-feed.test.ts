import type { ICrmOrderFeedView } from '../../src/modules/crm/order-feed/crm-order-feed.domain';

import { describe, expect, it, vi } from 'vitest';

import { CRM_SECTIONS, CRM_STORE_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import {
  ORDER_FEED_ACT_NOTE,
  ORDER_FEED_KIND,
  ORDER_FEED_NOT_CONNECTED_TEXT,
} from '../../src/modules/crm/order-feed/crm-order-feed.domain';
import { CrmOrderFeedKinds } from '../../src/modules/crm/order-feed/crm-order-feed.kinds';
import { orderFeedOf } from '../../src/modules/finance/order-feed';
import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';

const SELLER = '111';
const NOW = new Date('2026-10-18T09:00:00Z');

const ALL_OPEN = { [FEATURE.ORDER_FEED]: true, [FEATURE.OZON]: true, [FEATURE.WB]: true };

const ymOrder = (id: number, creationDate: string) => ({
  id,
  status: 'DELIVERED',
  creationDate,
  items: [{ offerId: 'A1', offerName: 'Casio A1', count: 1, price: 1500 }],
});

const ozonOrder = (id: string) => ({
  marketplace: 'ozon',
  id,
  orderNumber: id.split('-').slice(0, 2).join('-'),
  scheme: 'FBS',
  stage: 'in_transit',
  status: 'delivering',
  substatus: null,
  createdDay: '2026-10-10',
  items: [{ sku: 'OZ-A1', count: 1, price: 1400 }],
  sales: 1400,
});

interface IFakes {
  ozonOrders?: ReturnType<typeof vi.fn>;
  placed?: ReturnType<typeof vi.fn>;
}

function kinds(fakes: IFakes = {}) {
  const ozonOrders =
    fakes.ozonOrders ??
    vi.fn(async () => ({ orders: [ozonOrder('1-2-1')], cancelled: [ozonOrder('3-4-1')] }));
  const capabilities: Record<string, Record<string, unknown>> = {
    ym: { orders: { listOrders: vi.fn() } },
    ozon: { orders: { listOrders: ozonOrders } },
  };
  const marketplaces = {
    capability: (mp: string, cap: string) => capabilities[mp]?.[cap] ?? null,
    require: (mp: string, cap: string) => capabilities[mp][cap],
  };
  const placed =
    fakes.placed ??
    vi.fn(async (store: { campaign_id: string }) =>
      store.campaign_id === 'c1'
        ? { orders: [ymOrder(100, '01-10-2026')], cancelled: [] }
        : { orders: [ymOrder(200, '05-10-2026')], cancelled: [] },
    );
  const reports = { collectPlacedOrders: placed };
  const orderFeed = {
    list: vi.fn(async (_uid: string, marketplace: 'ym' | 'ozon', orders: never[]) =>
      orderFeedOf(marketplace, orders, [], () => undefined),
    ),
  };
  const register = vi.fn();
  const instance = new CrmOrderFeedKinds(
    { register } as never,
    marketplaces as never,
    reports as never,
    orderFeed as never,
  );
  return { instance, register, ozonOrders, placed, orderFeed };
}

const context = (features: Record<string, boolean> = ALL_OPEN, params = {}) =>
  ({
    telegramUserId: SELLER,
    store: {
      telegramUserId: SELLER,
      name: 'Первый',
      campaign_id: 'c1',
      token: 't',
      stores: [
        { campaignId: 'c1', storeName: 'Первый', placementType: 'FBS' },
        { campaignId: 'c2', storeName: 'Второй', placementType: 'FBY' },
      ],
    } as never,
    params,
    features,
  }) as const;

describe('«Лента заказов» CRM (TASK-144)', () => {
  it('/ym — заказы всех магазинов кабинета, Ozon не запрашивается (TASK-182)', async () => {
    const { instance, placed, ozonOrders, orderFeed } = kinds();
    const { data } = await instance.list(context(ALL_OPEN, { period: { key: PERIOD.WEEK } }), NOW);
    const view = data as ICrmOrderFeedView;

    expect(placed).toHaveBeenCalledTimes(2);
    expect(ozonOrders).not.toHaveBeenCalled();
    expect(orderFeed.list).toHaveBeenCalledTimes(1);
    expect(view.marketplace).toBe('ym');
    expect(view.rows.map((row) => [row.marketplace, row.id, row.scheme])).toEqual([
      ['ym', '200', 'FBY'],
      ['ym', '100', 'FBS'],
    ]);
    expect(view.totals.map((t) => [t.marketplace, t.orders])).toEqual([['ym', 2]]);
    expect(view.marketplaces.map((m) => m.marketplace)).toEqual(['ym']);
    expect(view.period).toEqual({ key: PERIOD.WEEK, day: null });
    expect(view.stages).toHaveLength(10);
    expect(view.notes).toEqual([ORDER_FEED_ACT_NOTE]);
  });

  it('/ozon — только Ozon с отменёнными, ЯМ не запрашивается; без дублей с /ym', async () => {
    const { instance, placed, ozonOrders, orderFeed } = kinds();
    const params = { period: { key: PERIOD.WEEK }, marketplace: 'ozon' };
    const view = (await instance.list(context(ALL_OPEN, params), NOW)).data as ICrmOrderFeedView;

    expect(placed).not.toHaveBeenCalled();
    expect(ozonOrders).toHaveBeenCalledWith(
      { telegramUserId: SELLER, marketplace: 'ozon' },
      { key: PERIOD.WEEK },
      NOW,
    );
    expect(orderFeed.list).toHaveBeenCalledTimes(1);
    expect(view.marketplace).toBe('ozon');
    expect(view.rows.map((row) => [row.marketplace, row.id, row.scheme])).toEqual([
      ['ozon', '1-2-1', 'FBS'],
      ['ozon', '3-4-1', 'FBS'],
    ]);
    expect(view.totals.map((t) => [t.marketplace, t.orders])).toEqual([['ozon', 2]]);
    expect(view.notes).not.toContain(ORDER_FEED_ACT_NOTE);
    expect(view.rows[0].profitGap).toBe('no-operations');

    const ym = (await instance.list(context(ALL_OPEN), NOW)).data as ICrmOrderFeedView;
    const ids = [...view.rows, ...ym.rows].map((row) => `${row.marketplace}:${row.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('площадка: мусор и закрытая фича — отказ, а не тихий ЯМ', async () => {
    const { instance, ozonOrders } = kinds();
    await expect(
      instance.list(context(ALL_OPEN, { marketplace: 'amazon' }), NOW),
    ).rejects.toThrow('Площадка указана неверно');
    await expect(
      instance.list(context({ [FEATURE.ORDER_FEED]: true }, { marketplace: 'ozon' }), NOW),
    ).rejects.toThrow('«Ozon» закрыта');
    expect(ozonOrders).not.toHaveBeenCalled();
  });

  it('площадка без возможности orders — пустая лента, а не исключение', async () => {
    const { instance } = kinds();
    const view = (await instance.list(context(ALL_OPEN, { marketplace: 'wb' }), NOW))
      .data as ICrmOrderFeedView;
    expect(view.marketplace).toBe('wb');
    expect(view.rows).toEqual([]);
    expect(view.marketplaces).toEqual([]);
  });

  it('Ozon не подключён — строка причины', async () => {
    const { instance } = kinds({
      ozonOrders: vi.fn(async () => {
        throw new MarketplaceNotConnectedError('ozon', SELLER, 'no-credentials');
      }),
    });
    const view = (await instance.list(context(ALL_OPEN, { marketplace: 'ozon' }), NOW))
      .data as ICrmOrderFeedView;
    expect(view.rows).toEqual([]);
    expect(view.marketplaces).toEqual([
      { marketplace: 'ozon', label: expect.any(String), state: 'not-connected' },
    ]);
    expect(view.problems).toEqual([
      { marketplace: 'ozon', storeName: null, problem: ORDER_FEED_NOT_CONNECTED_TEXT('ozon') },
    ]);
  });

  it('сбой магазина ЯМ — строка причины, остальные магазины живут', async () => {
    const { instance } = kinds({
      placed: vi.fn(async (store: { campaign_id: string }) => {
        if (store.campaign_id === 'c2') throw new Error('Маркет не ответил');
        return { orders: [ymOrder(100, '01-10-2026')], cancelled: [] };
      }),
    });
    const view = (await instance.list(context(), NOW)).data as ICrmOrderFeedView;
    expect(view.rows.map((row) => row.id)).toEqual(['100']);
    expect(view.marketplaces).toEqual([
      { marketplace: 'ym', label: expect.any(String), state: 'ok' },
    ]);
    expect(view.problems.some((p) => p.marketplace === 'ym' && p.storeName === 'Второй')).toBe(
      true,
    );
  });

  it('мусорный период — ошибка задачи, а не молчаливое умолчание', async () => {
    const { instance } = kinds();
    await expect(instance.list(context(ALL_OPEN, { period: { key: 'year' } }), NOW)).rejects.toThrow(
      'период',
    );
  });

  it('kind аккаунта под order_feed; фича выключена и требует «Финансы»', () => {
    const { instance, register } = kinds();
    instance.onModuleInit();
    expect(register).toHaveBeenCalledWith(
      ORDER_FEED_KIND,
      expect.objectContaining({ features: [FEATURE.ORDER_FEED], scope: 'account' }),
    );
    expect(CRM_SECTIONS['ym-order-feed']).toEqual([FEATURE.ORDER_FEED]);
    expect(CRM_STORE_SECTIONS).not.toContain('ym-order-feed');
    expect(FEATURE_META[FEATURE.ORDER_FEED].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.ORDER_FEED].requires).toEqual([FEATURE.FINANCE]);
  });
});
