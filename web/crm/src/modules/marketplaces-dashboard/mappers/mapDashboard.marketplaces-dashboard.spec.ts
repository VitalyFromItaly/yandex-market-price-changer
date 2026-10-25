import type {
  DashboardColumn,
  MarketplacesDashboardResponse,
} from '../marketplaces-dashboard.domain';
import type { CompareMetrics } from '@/modules/marketplace-compare/marketplace-compare.domain';

import { describe, expect, it } from 'vitest';

import {
  barPoints,
  compareLink,
  dashboardCards,
  grainOf,
  pickMarginPct,
  pickNetRub,
  revenueSegments,
  timePoints,
  timeSeries,
} from './mapDashboard.marketplaces-dashboard';

const SEPT = { from: '2026-09-01', to: '2026-09-30' };
const AUG = { from: '2026-08-01', to: '2026-08-31' };

function metrics(over: Partial<CompareMetrics> = {}): CompareMetrics {
  return {
    revenueKopecks: 1_000_000,
    salesKopecks: 1_100_000,
    returnsKopecks: -100_000,
    returnsShare: 100_000 / 1_100_000,
    orders: 10,
    units: 12,
    avgCheckKopecks: 100_000,
    services: { commission: 0, logistics: 0, promotion: 0, withholdings: 0, otherServices: 0 },
    commissionShare: 0.15,
    marketplaceKopecks: -255_000,
    costShare: 0.255,
    cogsKopecks: 400_000,
    operatingExpensesKopecks: 30_000,
    taxKopecks: 60_000,
    netKopecks: 255_000,
    netMargin: 0.255,
    netPerOrderKopecks: 25_500,
    costComplete: true,
    ...over,
  };
}

function column(
  marketplace: DashboardColumn['marketplace'],
  over: Partial<DashboardColumn> = {},
): DashboardColumn {
  return {
    marketplace,
    label: marketplace.toUpperCase(),
    state: 'ok',
    reason: null,
    status: 'verified',
    statusLabel: 'Проверено',
    verified: true,
    metrics: metrics(),
    previous: null,
    schemes: [],
    days: [],
    ...over,
  };
}

const NO_JOURNAL = column('wb', {
  state: 'no-journal',
  reason: 'Журнал площадки за этот период не загружен — сравнивать нечего.',
  status: null,
  statusLabel: null,
  verified: false,
  metrics: null,
});

function response(columns: DashboardColumn[]): MarketplacesDashboardResponse {
  return {
    period: SEPT,
    previousPeriod: AUG,
    columns,
    conclusions: [],
    notes: [],
    operatingExpensesKopecks: 0,
    taxIsDefault: false,
  };
}

const ym = column('ym', {
  days: [
    { day: '2026-09-01', revenueKopecks: 400_000, units: 4, orders: 4 },
    { day: '2026-09-08', revenueKopecks: 600_000, units: 6, orders: 6 },
  ],
});
const ozon = column('ozon', {
  status: 'preliminary',
  statusLabel: 'Предварительно',
  verified: false,
  metrics: metrics({ revenueKopecks: 3_000_000, netKopecks: -50_000, netMargin: -0.0167 }),
  days: [{ day: '2026-09-02', revenueKopecks: 3_000_000, units: 30, orders: 20 }],
});

describe('дашборд «Площадки» — вид', () => {
  it('карточка площадки: KPI колонки как есть, доля — от выручки площадок с числами', () => {
    const [ymCard, ozonCard] = dashboardCards(response([ym, ozon, NO_JOURNAL]));
    const value = (card: typeof ymCard, key: string) =>
      card?.kpis.find((k) => k.key === key)?.value;
    expect(value(ymCard, 'share')).toBe('25,0 %');
    expect(value(ozonCard, 'share')).toBe('75,0 %');
    expect(ymCard?.statusTone).toBe('ok');
    expect(ozonCard?.statusTone).toBe('warn');
    // Убыток — красным, не меняя числа.
    expect(ozonCard?.kpis.find((k) => k.key === 'net')?.tone).toBe('danger');
  });

  it('площадка без журнала — «нет данных» с причиной, без KPI-нулей, не в долях и графиках', () => {
    const data = response([ym, ozon, NO_JOURNAL]);
    const wb = dashboardCards(data)[2];
    expect(wb?.reason).toBe(NO_JOURNAL.reason);
    expect(wb?.kpis).toEqual([]);
    expect(revenueSegments(data).map((s) => s.key)).toEqual(['ym', 'ozon']);
    expect(timeSeries(data).map((s) => s.key)).toEqual(['ym', 'ozon']);
    expect(barPoints(data, pickNetRub).map((p) => p.key)).toEqual(['ym', 'ozon']);
  });

  it('ряд во времени: Σ точек площадки = её выручке, пустые дни — нули, цвет по площадке', () => {
    const data = response([ym, ozon]);
    const days = timePoints(data, 'revenue', 'day');
    expect(days).toHaveLength(30);
    expect(days.reduce((sum, p) => sum + (p.values.ym ?? 0), 0)).toBe(10_000);
    expect(days[2]?.values).toEqual({ ym: 0, ozon: 0 });
    const weeks = timePoints(data, 'orders', 'week');
    expect(weeks[0]).toMatchObject({ label: '01-09–06-09', values: { ym: 4, ozon: 20 } });
    expect(timeSeries(data).map((s) => s.tone)).toEqual(['c1', 'c2']);
  });

  it('шаг по длине периода: месяц — дни, квартал — недели, год — месяцы', () => {
    expect(grainOf(SEPT)).toBe('day');
    expect(grainOf({ from: '2026-07-01', to: '2026-09-30' })).toBe('week');
    expect(grainOf({ from: '2025-10-01', to: '2026-09-30' })).toBe('month');
  });

  it('маржа в процентах; не посчитанная — площадки на графике нет', () => {
    const data = response([ym, column('ozon', { metrics: metrics({ netMargin: null }) })]);
    expect(barPoints(data, pickMarginPct)).toEqual([{ key: 'ym', label: 'YM', value: 25.5 }]);
  });

  it('ссылки: площадка — в её «Финансы», показатель — в «Сравнение площадок» за тот же период', () => {
    const [card] = dashboardCards(response([ym, ozon]));
    expect(card?.to).toEqual({
      name: 'ym-finance',
      params: { tab: 'pnl' },
      query: expect.objectContaining({ from: SEPT.from, to: SEPT.to }),
    });
    expect(compareLink(SEPT)).toEqual({
      name: 'ym-marketplace-compare',
      query: expect.objectContaining({ from: SEPT.from, to: SEPT.to }),
    });
  });
});
