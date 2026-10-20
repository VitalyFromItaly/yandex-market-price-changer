import type { IExpenseAllocation } from '../../src/modules/finance/expense-allocation';
import type { IFinancePeriod } from '../../src/modules/finance/finance-period';
import type {
  IForecast,
  IForecastInput,
  IForecastReport,
} from '../../src/modules/finance/forecast';
import type { IPnlLine } from '../../src/modules/finance/pnl';
import type { ITaxSettings } from '../../src/modules/finance/tax.domain';

import { describe, expect, it } from 'vitest';

import { monthsOf, shiftDay } from '../../src/modules/finance/finance-period';
import {
  backtestOf,
  FORECAST_NO_JOURNAL,
  FORECAST_NO_SALES,
  forecastOf,
  forecastPlan,
  project,
  ZERO_METRICS,
} from '../../src/modules/finance/forecast';
import { purchaseNeedsOf } from '../../src/modules/finance/forecast-purchases';
import { pnlOf } from '../../src/modules/finance/pnl';

/** «Прогнозы» (TASK-151): линейная экстраполяция над готовым P&L, бэктест, закупки. */

const NO_EXPENSES: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };
const USN_6: ITaxSettings = { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' };
const TODAY = '2026-10-17';

/** Каждый день с 01.09 по 16.10 — одна продажа на 1 000 ₽, закуп 600 ₽, оплачена в тот же день. */
const LINES: IPnlLine[] = [];
for (let day = '2026-09-01'; day <= '2026-10-16'; day = shiftDay(day, 1)) {
  LINES.push({
    id: `op-${day}`,
    article: 'sales',
    amountKopecks: 100_000,
    sku: 'A',
    count: 1,
    goods: 'sold',
    orderId: `o-${day}`,
    accruedDay: day,
    paidDay: day,
  });
}

function report(
  period: IFinancePeriod,
  status: 'preliminary' | null = 'preliminary',
): IForecastReport {
  return {
    pnl: pnlOf({
      lines: LINES,
      period,
      costOf: () => 60_000,
      expenses: NO_EXPENSES,
      tax: USN_6,
    }),
    months: monthsOf(period).map((m) => ({ ...m, status })),
  };
}

function input(basisDays: 14 | 28 = 14): IForecastInput {
  const plan = forecastPlan(TODAY, basisDays);
  return {
    plan,
    basis: report(plan.basis),
    monthFact: plan.monthFact ? report(plan.monthFact) : null,
    yearFact: plan.yearFact ? report(plan.yearFact) : null,
    marginMonths: plan.marginMonths.map((m) =>
      report(m, m.from < '2026-09-01' ? null : 'verified'),
    ),
    receivable: { asOf: TODAY, totalKopecks: 500_000 },
    taxIsDefault: true,
    tax: { regime: 'usn_income', rateBasisPoints: 600 },
  };
}

describe('shiftDay', () => {
  it('через границы месяца и года', () => {
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('forecastPlan', () => {
  it('окно — N дней по вчера, факт месяца — с 1-го по вчера, сегодня — в оставшихся', () => {
    const plan = forecastPlan(TODAY, 28);
    expect(plan.basis).toEqual({ from: '2026-09-19', to: '2026-10-16' });
    expect(plan.monthFact).toEqual({ from: '2026-10-01', to: '2026-10-16' });
    expect(plan.monthRemainingDays).toBe(15);
    expect(plan.yearFact).toEqual({ from: '2026-01-01', to: '2026-10-16' });
    expect(plan.yearRemainingDays).toBe(76);
    expect(plan.marginMonths.map((m) => m.from.slice(0, 7))).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('1-го числа факта месяца нет, 1 января — и года; закрытые месяцы уходят в прошлый год', () => {
    const first = forecastPlan('2026-10-01', 14);
    expect(first.monthFact).toBeNull();
    expect(first.monthRemainingDays).toBe(31);
    const newYear = forecastPlan('2027-01-01', 14);
    expect(newYear.yearFact).toBeNull();
    expect(newYear.yearRemainingDays).toBe(365);
    expect(newYear.basis).toEqual({ from: '2026-12-18', to: '2026-12-31' });
    expect(newYear.marginMonths[5].from).toBe('2026-12-01');
  });
});

describe('forecastOf', () => {
  it('прогноз = факт + средний день × оставшиеся, по каждому показателю', () => {
    const result = forecastOf(input(14));
    expect(result.ok).toBe(true);
    // strictNullChecks выключен — union не сужается.
    const f = (result as { forecast: IForecast }).forecast;
    // 16 дней факта по 1 000 ₽ + 15 оставшихся по среднему дню 1 000 ₽.
    expect(f.month.fact.revenueKopecks).toBe(1_600_000);
    expect(f.month.forecast.revenueKopecks).toBe(3_100_000);
    expect(f.month.forecast.units).toBe(31);
    // Чистая штуки: 1 000 − 600 − 6 % налога = 340 ₽.
    expect(f.month.forecast.netKopecks).toBe(31 * 34_000);
    expect(f.month.forecast.taxKopecks).toBe(31 * 6_000);
    expect(f.month.netMargin).toBeCloseTo(0.34);
    expect(f.taxShare).toBeCloseTo(0.06);
    expect(f.daily.revenueKopecks).toBe(100_000);
    // Год: продажи начались 01.09 — 46 дней факта + 76 оставшихся.
    expect(f.year.forecast.revenueKopecks).toBe((46 + 76) * 100_000);
    expect(f.inflow.accrualsKopecks).toBe(15 * 100_000);
    expect(f.inflow.totalKopecks).toBe(500_000 + 15 * 100_000);
    expect(f.method.text).toContain('14 дн.');
    expect(f.method.text).toContain('03.10–16.10');
    // Незагруженные месяцы — «нет данных», а не ноль; последний — прогноз.
    expect(f.margins.map((m) => [m.month, m.kind, m.netMargin === null])).toEqual([
      ['2026-04', 'fact', true],
      ['2026-05', 'fact', true],
      ['2026-06', 'fact', true],
      ['2026-07', 'fact', true],
      ['2026-08', 'fact', true],
      ['2026-09', 'fact', false],
      ['2026-10', 'forecast', false],
    ]);
  });

  it('журнал месяца окна не загружен — причина, а не нули', () => {
    const base = input(28);
    base.basis.months[0].status = null;
    expect(forecastOf(base)).toEqual({ ok: false, reason: FORECAST_NO_JOURNAL('09.2026') });
  });

  it('продаж в окне нет — причина', () => {
    const base = input(14);
    base.basis = {
      pnl: pnlOf({
        lines: [],
        period: base.plan.basis,
        costOf: () => 0,
        expenses: NO_EXPENSES,
        tax: USN_6,
      }),
      months: monthsOf(base.plan.basis).map((m) => ({ ...m, status: 'preliminary' })),
    };
    expect(forecastOf(base)).toEqual({ ok: false, reason: FORECAST_NO_SALES(14) });
  });

  it('project округляет один раз на показатель', () => {
    const daily = { ...ZERO_METRICS, revenueKopecks: 10 };
    expect(project(ZERO_METRICS, daily, 3, 1).revenueKopecks).toBe(3);
  });
});

describe('backtestOf', () => {
  const days = (from: string, to: string, value: (day: string) => number) => {
    const out: { day: string; revenueKopecks: number }[] = [];
    for (let day = from; day <= to; day = shiftDay(day, 1))
      out.push({ day, revenueKopecks: value(day) });
    return out;
  };
  const SEPT = { from: '2026-09-01', to: '2026-09-30' };

  it('ровный ряд — ошибка 0 при любом окне и дне отсечения', () => {
    const { summary } = backtestOf(
      days('2026-07-01', '2026-09-30', () => 100),
      [SEPT],
      [7, 15],
      [14, 28],
    );
    expect(summary.every((s) => s.mape === 0 && s.months === 1)).toBe(true);
  });

  it('растущий ряд — прогноз ниже факта; дни вне месяца пропускаются', () => {
    const { rows } = backtestOf(
      days(
        '2026-07-01',
        '2026-09-30',
        (day) => Number(day.slice(8, 10)) + (day >= '2026-09-01' ? 50 : 0),
      ),
      [SEPT],
      [1, 15, 40],
      [14],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cutDay).toBe(15);
    expect(rows[0].forecastKopecks).toBeLessThan(rows[0].actualKopecks);
    expect(rows[0].error).toBeGreaterThan(0);
  });
});

describe('purchaseNeedsOf', () => {
  const sold = new Map([
    ['fast', 28],
    ['slow', 7],
    ['nocost', 14],
    ['returned', 0],
  ]);
  const stocks = new Map([
    ['fast', 10],
    ['slow', 100],
  ]);
  const costs = new Map([
    ['fast', 500],
    ['slow', 250.5],
  ]);

  it('докупить = ⌈скорость × запас − остаток⌉, без закупа — счётчиком; первыми кончающиеся', () => {
    const needs = purchaseNeedsOf(sold, stocks, costs, 14, 30);
    expect(needs.rows.map((r) => [r.sku, r.unitsPerDay, r.stock, r.daysLeft, r.needUnits])).toEqual(
      [
        ['nocost', 1, 0, 0, 30],
        ['fast', 2, 10, 5, 50],
        ['slow', 0.5, 100, 200, 0],
      ],
    );
    expect(needs.rows[1].needKopecks).toBe(50 * 50_000);
    expect(needs.totalKopecks).toBe(50 * 50_000);
    expect(needs.totalUnits).toBe(80);
    expect(needs.withoutCost).toEqual({ skus: 1, units: 30 });
  });

  it('остатки не получены — stock null, докупить на весь запас', () => {
    const needs = purchaseNeedsOf(new Map([['fast', 28]]), null, costs, 14, 30);
    expect(needs.rows[0]).toMatchObject({ stock: null, daysLeft: null, needUnits: 60 });
  });
});
