import type { FbyResponse } from '@/modules/fby/fby.domain';
import type { OrdersReportResponse } from '@/modules/orders/orders.domain';
import type { ProfitBlockResponse, ProfitResponse } from '@/modules/profit/profit.domain';

import { describe, expect, it } from 'vitest';

import {
  mapOrdersKpi,
  mapOrdersRow,
  mapProfitKpis,
  mapProfitRows,
  mapProfitSeries,
  mapStockKpi,
  mapUnitEconomics,
} from './mapKpis.dashboard';

import { formatRub } from '@/shared/utils';

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
    byDay: [],
    undatedOrders: 0,
    bySku: [],
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
    excluded: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [], reason: '' },
    prices: { updatedAt: null, defaultPercent: 10, overrides: [], text: '' },
    main: 'placed',
    days: { from: '2026-09-01', to: '2026-09-24' },
    placed: block(),
    redeemed: block({ net: 500 }),
    cancelled: 0,
    estimate: null,
    promo: [],
    notes: { placed: '', otherOrders: '', unknownSkus: '' },
    ...overrides,
  };
}

function fby(overrides: Partial<FbyResponse> = {}): FbyResponse {
  return {
    takenAt: '13-10-2026 10:05',
    stockTakenAt: '13-10-2026 10:00',
    stockTypes: [{ type: 'AVAILABLE', label: 'доступно' }],
    stockHint: '',
    stockProblem: null,
    stock: {
      totals: {
        AVAILABLE: 1482,
        FIT: 1500,
        FREEZE: 0,
        QUARANTINE: 0,
        DEFECT: 0,
        EXPIRED: 0,
        UTILIZATION: 0,
      },
      clusters: [],
      problems: [],
    },
    requests: null,
    requestsProblem: null,
    supplies: { state: 'off' },
    inTransit: null,
    returning: null,
    file: null,
    ...overrides,
  };
}

describe('карточки главной', () => {
  it('заказы: число, сумма продаж и момент среза — как на странице отчёта', () => {
    expect(mapOrdersKpi(orders())).toEqual({
      value: '42',
      caption: `на 12${NBSP}345${NBSP}₽`,
      heading: 'на 24-09-2026 10:00 МСК',
      empty: false,
      emptyText: 'До клиента сейчас ничего не едет.',
      tone: 'neutral',
    });
  });

  it('ноль — пустой хороший день со словами бэкенда, без суммы', () => {
    const kpi = mapOrdersKpi(
      orders({ count: 0, totals: { sales: 0, subsidies: 0, withDelivery: 0 } }),
    );
    expect(kpi.empty).toBe(true);
    expect(kpi.value).toBe('0');
    expect(kpi.caption).toBeNull();
  });

  it('деньги — из основного блока; комиссия и налог подписаны настроенным процентом', () => {
    const kpis = mapProfitKpis(profit());
    expect(kpis.sales.value).toBe(`10${NBSP}000${NBSP}₽`);
    expect(kpis.sales.caption).toBe('оформлено 10');
    expect(kpis.commission.caption).toBe('23% от продаж');
    expect(kpis.tax.value).toBe(`700${NBSP}₽`);
    expect(kpis.tax.caption).toBe('7% от продаж');
    expect(kpis.purchase.caption).toBe('50% от продаж');
    expect(kpis.net.value).toBe(`2${NBSP}000${NBSP}₽`);
    expect(kpis.net.caption).toBe('Ожидается чистая · маржа 20%');
    expect(kpis.net.tone).toBe('ok');
    expect(kpis.net.heading).toBe('с 01-09-2026 по 24-09-2026');

    const redeemed = mapProfitKpis(profit({ main: 'redeemed' }));
    expect(redeemed.net.value).toBe(`500${NBSP}₽`);
    expect(redeemed.net.caption).toBe('Чистая · маржа 5%');
    expect(redeemed.sales.caption).toBe('заказов 10');
  });

  it('убыток красится, пустой период — текст бэкенда только на итоговой', () => {
    expect(mapProfitKpis(profit({ placed: block({ net: -300 }) })).net.tone).toBe('danger');

    const empty = mapProfitKpis(profit({ empty: true, placed: block({ orders: 0, revenue: 0 }) }));
    expect(empty.sales.caption).toBeNull();
    expect(empty.sales.empty).toBe(false);
    expect(empty.net.empty).toBe(true);
    expect(empty.net.emptyText).toBe('За этот период заказов нет.');
  });

  it('остатки FBY — доступные штуки на момент отчёта; нет отчёта — причина', () => {
    const kpi = mapStockKpi(fby());
    expect(kpi.value).toBe(`1${NBSP}482 шт.`);
    expect(kpi.heading).toBe('на 13-10-2026 10:00 МСК');

    const missing = mapStockKpi(fby({ stock: null, stockProblem: 'Остатки обновляются.' }));
    expect(missing.empty).toBe(true);
    expect(missing.emptyText).toBe('Остатки обновляются.');
  });
});

describe('блок «Заказы» на главной', () => {
  it('строка среза: число, «на N ₽» и момент — из маппера страницы отчёта', () => {
    expect(mapOrdersRow(orders())).toEqual({
      count: '42',
      amount: `на 12${NBSP}345${NBSP}₽`,
      heading: 'на 24-09-2026 10:00 МСК',
    });
    const empty = mapOrdersRow(
      orders({ count: 0, totals: { sales: 0, subsidies: 0, withDelivery: 0 } }),
    );
    expect(empty).toMatchObject({ count: '0', amount: null });
  });

  it('оформлено — из блока placed, даже когда основной блок выкупленный', () => {
    const rows = mapProfitRows(
      profit({ main: 'redeemed', placed: block({ orders: 7, revenue: 3500 }), cancelled: 2 }),
    );
    expect(rows.placed).toEqual({
      count: '7',
      amount: `на 3${NBSP}500${NBSP}₽`,
      heading: 'с 01-09-2026 по 24-09-2026',
    });
  });

  it('отменено — только число: суммы в ответе нет, это «—», а не «0 ₽»', () => {
    expect(mapProfitRows(profit({ cancelled: 3 })).cancelled).toEqual({
      count: '3',
      amount: null,
      heading: 'с 01-09-2026 по 24-09-2026',
    });
    expect(mapProfitRows(profit({ cancelled: 0 })).cancelled.amount).toBeNull();
  });
});

describe('mapProfitSeries — график «Выручка и чистая прибыль»', () => {
  const byDay = [
    { date: '2026-09-02', revenue: 6000, net: 1500 },
    { date: '2026-09-04', revenue: 4000, net: 500 },
  ];
  const sum = (points: { values: Record<string, number> }[], key: string) =>
    points.reduce((acc, p) => acc + (p.values[key] ?? 0), 0);

  it('ряд основного блока, дни периода без заказов — нули, Σ = карточкам', () => {
    const response = profit({
      days: { from: '2026-09-01', to: '2026-09-05' },
      placed: block({ revenue: 10000, net: 2000, byDay }),
    });
    const series = mapProfitSeries(response);

    expect(series.points.map((p) => p.label)).toEqual([
      '01-09',
      '02-09',
      '03-09',
      '04-09',
      '05-09',
    ]);
    expect(series.points[0]?.values).toEqual({ revenue: 0, net: 0 });
    expect(series.points[1]?.hint).toBe('02-09-2026');
    expect(sum(series.points, 'revenue')).toBe(10000);
    expect(sum(series.points, 'net')).toBe(2000);
  });

  it('основной блок — выкупленный, когда так решил сервер', () => {
    const response = profit({
      main: 'redeemed',
      days: { from: '2026-09-01', to: '2026-09-02' },
      placed: block({ byDay: [{ date: '2026-09-01', revenue: 1, net: 1 }] }),
      redeemed: block({ byDay: [{ date: '2026-09-02', revenue: 700, net: 70 }], undatedOrders: 2 }),
    });
    const series = mapProfitSeries(response);
    expect(sum(series.points, 'revenue')).toBe(700);
    expect(series.undated).toBe(2);
  });

  it('«Всего» без границ — от первого дня с заказами до последнего', () => {
    const series = mapProfitSeries(profit({ days: null, placed: block({ byDay }) }));
    expect(series.points.map((p) => p.key)).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
  });
});

describe('mapUnitEconomics', () => {
  it('строка ЯМ — основной блок «Прибыли»: те же числа, маржа и тон; Ozon/WB — «скоро»', () => {
    const [ym, ...upcoming] = mapUnitEconomics(profit());
    const main = profit().placed;
    expect(ym).toMatchObject({
      key: 'ym',
      active: true,
      sales: formatRub(main.revenue),
      commission: formatRub(main.commission),
      commissionShare: '23%',
      taxShare: '7%',
      net: formatRub(main.net),
      margin: '20%',
      tone: 'ok',
    });
    expect(upcoming.map((row) => [row.label, row.active, row.sales])).toEqual([
      ['Ozon', false, null],
      ['Wildberries', false, null],
    ]);
  });

  it('убыток — красная маржа', () => {
    const loss = block({ net: -500 });
    const [ym] = mapUnitEconomics(profit({ placed: loss, redeemed: loss }));
    expect(ym?.tone).toBe('danger');
  });
});

describe('деньги главной — целыми рублями', () => {
  it('копейки KPI и unit-экономики округляются', () => {
    const fractional = block({ commission: 244987.36, net: 280874.98 });
    const response = profit({ placed: fractional, redeemed: fractional });
    expect(mapProfitKpis(response).commission.value).toBe(formatRub(244987));
    expect(mapProfitKpis(response).net.value).toBe(formatRub(280875));
    expect(mapUnitEconomics(response)[0]?.commission).toBe(formatRub(244987));
  });
});
