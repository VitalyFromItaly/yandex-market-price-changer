import type { OrdersReportResponse } from '@/modules/orders/orders.domain';
import type { ProfitBlockResponse, ProfitResponse } from '@/modules/profit/profit.domain';

import { describe, expect, it } from 'vitest';

import { mapOrdersTile, mapProfitTile } from './mapTiles.dashboard';

const NBSP = String.fromCharCode(0xa0);

function orders(overrides: Partial<OrdersReportResponse> = {}): OrdersReportResponse {
  return {
    key: 'in_transit',
    title: 'Едет до клиента',
    count: 42,
    totals: { sales: 12345, subsidies: 0, withDelivery: 12345 },
    period: { key: 'all', day: null },
    periodTitle: null,
    takenAt: '24-09-2026 10:00',
    assembling: null,
    returns: null,
    notes: [],
    emptyText: 'До клиента сейчас ничего не едет.',
    rows: [],
    file: null,
    ...overrides,
  };
}

function block(overrides: Partial<ProfitBlockResponse> = {}): ProfitBlockResponse {
  return {
    orders: 10,
    revenue: 10000,
    subsidies: 0,
    commission: 2300,
    commissionPercent: 23,
    tax: 700,
    taxPercent: 7,
    promo: 0,
    purchase: 5000,
    net: 2000,
    ...overrides,
  };
}

function profit(overrides: Partial<ProfitResponse> = {}): ProfitResponse {
  return {
    key: 'profit',
    period: { key: 'month', day: null },
    title: 'Прибыль',
    periodTitle: 'с 01-09-2026 по 24-09-2026',
    emptyText: 'За этот период заказов нет.',
    empty: false,
    returned: { orders: 0, revenue: 0 },
    excluded: { orders: 0, revenue: 0, skus: [], reason: '' },
    prices: { updatedAt: null, defaultPercent: 10, overrides: [], text: '' },
    main: 'placed',
    placed: block(),
    redeemed: block({ net: 500 }),
    cancelled: 0,
    estimate: null,
    promo: [],
    notes: { placed: '', otherOrders: '', unknownSkus: '' },
    ...overrides,
  };
}

describe('плитки главной', () => {
  it('заказы: число, сумма продаж и момент среза — как на странице отчёта', () => {
    expect(mapOrdersTile(orders())).toEqual({
      value: '42',
      caption: `на 12${NBSP}345${NBSP}₽`,
      heading: 'на 24-09-2026 10:00 МСК',
      empty: false,
      emptyText: 'До клиента сейчас ничего не едет.',
      negative: false,
    });
  });

  it('ноль — пустой хороший день со словами бэкенда, без суммы', () => {
    const tile = mapOrdersTile(
      orders({ count: 0, totals: { sales: 0, subsidies: 0, withDelivery: 0 } }),
    );
    expect(tile.empty).toBe(true);
    expect(tile.value).toBe('0');
    expect(tile.caption).toBeNull();
  });

  it('прибыль: чистая основного блока и его подпись', () => {
    const placed = mapProfitTile(profit());
    expect(placed.value).toBe(`2${NBSP}000${NBSP}₽`);
    expect(placed.caption).toBe('Ожидается чистая · оформлено 10');

    const redeemed = mapProfitTile(profit({ main: 'redeemed' }));
    expect(redeemed.value).toBe(`500${NBSP}₽`);
    expect(redeemed.caption).toBe('Чистая · заказов 10');
  });

  it('убыток помечается', () => {
    expect(mapProfitTile(profit({ placed: block({ net: -300 }) })).negative).toBe(true);
  });
});
