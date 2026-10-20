import type { SalesAnalyticsResponse, SalesSku } from '../sales-analytics.domain';

import { describe, expect, it } from 'vitest';

import {
  brandRows,
  bucketKey,
  bucketsOf,
  chartPoints,
  filterSkus,
  formatVelocity,
  kpisOf,
} from './mapSalesAnalytics.sales-analytics';

const figures = (revenueKopecks: number, units: number, orders: number) => ({
  revenueKopecks,
  units,
  orders,
  avgCheckKopecks: orders ? Math.round(revenueKopecks / orders) : null,
  unitsPerDay: units / 30,
});

const sku = (code: string, name: string | null, revenue: number, units: number): SalesSku => ({
  sku: code,
  name,
  brand: null,
  ...figures(revenue, units, 1),
  previous: null,
});

const DATA: SalesAnalyticsResponse = {
  period: { from: '2026-09-01', to: '2026-09-30' },
  previousPeriod: { from: '2026-08-01', to: '2026-08-31' },
  status: 'final',
  statusLabel: 'Предварительные данные',
  periodDays: 30,
  totals: figures(600_000, 6, 3),
  previousTotals: figures(300_000, 3, 3),
  days: [
    { day: '2026-09-01', revenueKopecks: 100_000, units: 1, orders: 1 },
    { day: '2026-09-07', revenueKopecks: 200_000, units: 2, orders: 1 },
    { day: '2026-09-08', revenueKopecks: 300_000, units: 3, orders: 1 },
  ],
  skus: [sku('A1', 'Часы', 400_000, 4), sku('B2', null, 200_000, 2)],
  brands: [
    {
      key: 'casio',
      title: 'CASIO',
      skus: 1,
      ...figures(400_000, 4, 2),
      previous: { revenueKopecks: 500_000, units: 5 },
    },
    { key: null, title: 'Остальные', skus: 1, ...figures(200_000, 2, 1), previous: null },
  ],
  rest: { revenueKopecks: 0, units: 0 },
  marketplaces: [
    { marketplace: 'ym', label: 'Яндекс Маркет', ...figures(600_000, 6, 3), previous: null },
  ],
  unconfirmed: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [] } as never,
};

const total = (key: 'revenueKopecks' | 'units' | 'orders', grain: 'day' | 'week' | 'month') =>
  bucketsOf(DATA, grain).reduce((s, b) => s + b[key], 0);

describe('корзины ряда', () => {
  it('неделя — с понедельника, месяц — календарный', () => {
    expect(bucketKey('2026-09-07', 'week')).toBe('2026-09-07'); // понедельник
    expect(bucketKey('2026-09-06', 'week')).toBe('2026-08-31'); // воскресенье
    expect(bucketKey('2026-09-30', 'month')).toBe('2026-09');
  });

  it('пустые дни — нулями по границам периода', () => {
    const days = bucketsOf(DATA, 'day');
    expect(days).toHaveLength(30);
    expect(days[1]).toMatchObject({ label: '02-09', revenueKopecks: 0 });
  });

  it('Σ корзин = итогу при любом шаге', () => {
    for (const grain of ['day', 'week', 'month'] as const) {
      expect(total('revenueKopecks', grain), grain).toBe(600_000);
      expect(total('units', grain), grain).toBe(6);
      expect(total('orders', grain), grain).toBe(3);
    }
  });

  it('подпись недели — её дни внутри периода', () => {
    const weeks = bucketsOf(DATA, 'week');
    expect(weeks[0]).toMatchObject({ label: '01-09–06-09', revenueKopecks: 100_000 });
    expect(weeks[1]).toMatchObject({ label: '07-09–13-09', revenueKopecks: 500_000 });
    expect(bucketsOf(DATA, 'month')).toEqual([
      expect.objectContaining({ label: '09-2026', revenueKopecks: 600_000 }),
    ]);
  });

  it('график выручки — в рублях, тултип называет все три числа', () => {
    const points = chartPoints(bucketsOf(DATA, 'month'), 'revenue');
    expect(points[0]?.value).toBe(6000);
    expect(points[0]?.hint).toContain('3 заказа');
    expect(points[0]?.hint).toContain('6 шт.');
  });
});

describe('карточки и строки', () => {
  it('KPI с динамикой к прошлому периоду', () => {
    const kpis = kpisOf(DATA);
    expect(kpis.map((k) => k.key)).toEqual(['revenue', 'orders', 'units', 'avgCheck', 'velocity']);
    expect(kpis[0]?.caption).toBe('+100 % к прошлому периоду');
    expect(kpis[1]?.caption).toBe('как в прошлом периоде');
  });

  it('строки брендов: динамика выручки с тоном; без прошлого — прочерка нет', () => {
    const rows = brandRows(DATA);
    expect(rows[0]).toMatchObject({
      title: 'CASIO',
      subtitle: '1 товар',
      delta: '−20 %',
      deltaTone: 'danger',
    });
    expect(rows[1]).toMatchObject({ delta: null, deltaTone: 'muted' });
  });

  it('скорость: шт./день, без дней — прочерк', () => {
    expect(formatVelocity(0.2)).toBe('0,2 шт./день');
    expect(formatVelocity(null)).toBe('—');
  });

  it('поиск по названию и артикулу, сортировка по штукам', () => {
    expect(filterSkus(DATA.skus, 'час', 'revenue').map((s) => s.sku)).toEqual(['A1']);
    expect(filterSkus(DATA.skus, 'b2', 'revenue').map((s) => s.sku)).toEqual(['B2']);
    expect(filterSkus(DATA.skus, '', 'units').map((s) => s.sku)).toEqual(['A1', 'B2']);
  });
});
