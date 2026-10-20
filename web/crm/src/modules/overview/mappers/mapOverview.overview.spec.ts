import type { OverviewTotals, SummaryResponse } from '../overview.domain';

import { describe, expect, it } from 'vitest';

import {
  deltaCaption,
  mapCancelledKpi,
  mapStocksKpis,
  mapSummaryKpis,
} from './mapOverview.overview';

const NBSP = String.fromCharCode(0xa0);
const rub = (text: string) => text.replace(/ /g, NBSP);

const totals = (over: Partial<OverviewTotals> = {}): OverviewTotals => ({
  from: '2026-09-01',
  to: '2026-09-30',
  levels: {
    revenueKopecks: 1_000_000,
    otherIncomeKopecks: 0,
    cogsKopecks: 400_000,
    grossKopecks: 600_000,
    marketplaceKopecks: -250_000,
    unrecognizedKopecks: 0,
    afterMarketplaceKopecks: 350_000,
    operatingExpensesKopecks: 50_000,
    operatingKopecks: 300_000,
    taxKopecks: 60_000,
    netKopecks: 240_000,
    grossMargin: 0.6,
    netMargin: 0.24,
  },
  salesKopecks: 1_100_000,
  returnsKopecks: -100_000,
  services: {
    commission: -150_000,
    logistics: -60_000,
    promotion: -20_000,
    withholdings: -15_000,
    otherServices: -5_000,
  },
  ordersCount: 4,
  units: 5,
  avgCheckKopecks: 250_000,
  ...over,
});

const summary = (over: Partial<SummaryResponse> = {}): SummaryResponse => ({
  current: totals(),
  previous: totals({ from: '2026-08-01', to: '2026-08-31', ordersCount: 5 }),
  status: 'preliminary',
  statusLabel: 'Предварительные данные',
  unconfirmed: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [] },
  taxIsDefault: false,
  receivable: { asOf: '2026-10-15', totalKopecks: 123_400, operationCount: 3 },
  ...over,
});

describe('карточки «Обзора»', () => {
  it('динамика: проценты от прошлого, ноль и равенство — словами', () => {
    expect(deltaCaption(110, 100)).toBe('+10 % к прошлому периоду');
    expect(deltaCaption(-150, -100)).toBe('−50 % к прошлому периоду');
    expect(deltaCaption(5, 0)).toBe('в прошлом периоде — ноль');
    expect(deltaCaption(0, 0)).toBeNull();
    expect(deltaCaption(100, 100)).toBe('как в прошлом периоде');
  });

  it('деньги — из уровней P&L; расходы без минуса; чистая — тоном знака', () => {
    const kpis = mapSummaryKpis(summary());
    expect(kpis.revenue?.value).toBe(rub('10 000 ₽'));
    expect(kpis.commission?.value).toBe(rub('1 500 ₽'));
    expect(kpis.returns?.value).toBe(rub('1 000 ₽'));
    expect(kpis.net).toMatchObject({ value: rub('2 400 ₽'), tone: 'ok' });
    expect(kpis.margin).toMatchObject({ value: '24 %', caption: 'валовая — 60 %' });
    expect(kpis.orders).toMatchObject({ value: '4', caption: '−20 % к прошлому периоду' });
    expect(kpis.units?.value).toBe('5 шт.');
    expect(kpis.receivable?.caption).toBe('3 операции без выплаты, на сегодня');
  });

  it('неполный закуп и налог по умолчанию — сказано вместо динамики', () => {
    const kpis = mapSummaryKpis(
      summary({
        unconfirmed: { confirmed: false, orders: 2, revenueKopecks: 350_000, skus: ['A'] },
        taxIsDefault: true,
      }),
    );
    expect(kpis.cogs?.caption).toMatch(/^Прибыль не подтверждена: 2 заказа на 3[\s\u00a0]500\s₽/);
    expect(kpis.tax?.caption).toContain('по умолчанию');
  });

  it('без заказов — средний чек прочерком, убыток — красным', () => {
    const current = totals({ ordersCount: 0, avgCheckKopecks: null });
    current.levels = { ...current.levels, netKopecks: -1, netMargin: null };
    const kpis = mapSummaryKpis(summary({ current }));
    expect(kpis.avgCheck).toMatchObject({ value: '—', caption: 'заказов нет' });
    expect(kpis.net?.tone).toBe('danger');
    expect(kpis.margin?.value).toBe('—');
  });

  it('остатки без закупа — счётчиком; закрытый отчёт в пути — прочерк с причиной', () => {
    const base = {
      takenAt: '2026-10-15T09:00:00Z',
      stockValueKopecks: 500_000,
      stockUnits: 12,
      withoutCost: { skus: 2, units: 3 },
      stores: 2,
      problems: [],
    };
    const kpis = mapStocksKpis({
      ...base,
      inTransit: { orders: 3, units: 4, salesKopecks: 9_900 },
    });
    expect(kpis.stockValue?.caption).toBe('12 шт.; без закупа 2 позиции — не учтены');
    expect(kpis.inTransit).toMatchObject({ value: '4 шт.', caption: `3 заказа на ${rub('99 ₽')}` });
    expect(mapStocksKpis({ ...base, inTransit: null }).inTransit?.value).toBe('—');
  });

  it('отмены: неподдержанный период — прочерк и причина сервера', () => {
    const base = { from: '2026-09-01', to: '2026-09-30', stores: 1, problems: [] };
    expect(mapCancelledKpi({ ...base, count: null, note: 'нельзя' }).cancelled).toMatchObject({
      value: '—',
      caption: 'нельзя',
    });
    expect(mapCancelledKpi({ ...base, count: 2, note: null }).cancelled?.caption).toBe(
      'заказа отменено',
    );
  });
});
