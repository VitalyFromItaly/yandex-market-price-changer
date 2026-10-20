/**
 * Прогнозы (TASK-151, ТЗ п.13) — детерминированные, без ИИ и без сезонности.
 * Чистые функции над готовыми `IPnl`: числа берутся из того же `pnlOf`, что
 * «Финансы», здесь только линейная экстраполяция.
 *
 * Метод один на все показатели (решение `forecast_basis_selectable`):
 *
 *   прогноз = факт с 1 числа по вчера + (Σ за последние N дней / N) × оставшиеся дни
 *
 * «Оставшиеся» считаются с СЕГОДНЯ: сегодняшний день в журнале ещё неполный, и
 * брать его фактом значило бы занизить и факт, и прогноз. N выбирает продавец
 * (14 / 28 / 56 — целые недели, дни недели не перекашивают среднее).
 *
 * Чистая, налог, возвраты и начисления «после площадки» идут тем же правилом,
 * что выручка: доля каждого показателя в выручке берётся из окна базы. Отсюда
 * второе свойство: прогноз рентабельности месяца — это рентабельность окна,
 * подмешанная к факту, и экран это говорит строкой метода.
 *
 * Нет базы — нет прогноза: журнал какого-то месяца окна не загружен или продаж
 * в окне нет — `ok: false` с причиной, а не нули. Ноль пересказывался бы
 * продавцу как «месяц закончится в ноль».
 */

import type { IFinancePeriod } from './finance-period';
import type { IPnlMonthStatus } from './finance.service';
import type { IPnl } from './pnl';
import type { TTaxRegime } from './tax.domain';
import type { IUnconfirmedProfit } from '../../shared/profit-confirmation';

import { monthPeriod, shiftDay } from './finance-period';

export const FORECAST_BASIS_DAYS = [14, 28, 56] as const;
export type TForecastBasisDays = (typeof FORECAST_BASIS_DAYS)[number];
export const DEFAULT_FORECAST_BASIS_DAYS: TForecastBasisDays = 28;

/** Сколько закрытых месяцев показывает динамика рентабельности. */
export const FORECAST_MARGIN_MONTHS = 6;

export function isForecastBasisDays(value: unknown): value is TForecastBasisDays {
  return FORECAST_BASIS_DAYS.includes(value as TForecastBasisDays);
}

/** Показатели, которые прогнозируются одним правилом. Копейки и штуки. */
export interface IForecastMetrics {
  /** Продажи + субсидии + возвраты — выручка «Финансов». */
  revenueKopecks: number;
  netKopecks: number;
  units: number;
  orders: number;
  /** Статья «Возвраты», со знаком журнала (обычно < 0). */
  returnsKopecks: number;
  taxKopecks: number;
  /**
   * Что Маркет перечислит: выручка + прочие доходы + удержания площадки +
   * нераспознанное, без себестоимости (её продавец платит не Маркету).
   */
  payableKopecks: number;
}

const METRIC_KEYS: readonly (keyof IForecastMetrics)[] = [
  'revenueKopecks',
  'netKopecks',
  'units',
  'orders',
  'returnsKopecks',
  'taxKopecks',
  'payableKopecks',
];

export const ZERO_METRICS: IForecastMetrics = {
  revenueKopecks: 0,
  netKopecks: 0,
  units: 0,
  orders: 0,
  returnsKopecks: 0,
  taxKopecks: 0,
  payableKopecks: 0,
};

export function metricsOf(pnl: IPnl): IForecastMetrics {
  return {
    revenueKopecks: pnl.revenueKopecks,
    netKopecks: pnl.netKopecks,
    units: pnl.units,
    orders: pnl.ordersCount,
    returnsKopecks: pnl.byArticle.returns.kopecks,
    taxKopecks: pnl.tax.taxKopecks,
    payableKopecks: pnl.afterMarketplaceKopecks + pnl.cogs.kopecks,
  };
}

/** Факт + средний день базы × оставшиеся дни, по каждому показателю. Округление — один раз. */
export function project(
  fact: IForecastMetrics,
  basis: IForecastMetrics,
  basisDays: number,
  remainingDays: number,
): IForecastMetrics {
  const out = { ...ZERO_METRICS };
  for (const key of METRIC_KEYS) {
    out[key] = fact[key] + Math.round((basis[key] * remainingDays) / basisDays);
  }
  return out;
}

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Какие периоды нужны прогнозу на `today` — их строит вызывающий через `FinanceService.build`. */
export interface IForecastPlan {
  today: string;
  basisDays: TForecastBasisDays;
  /** Последние N дней по вчера включительно. */
  basis: IFinancePeriod;
  /** Календарный месяц целиком. */
  month: IFinancePeriod;
  /** Факт месяца, с 1 числа по вчера; null — сегодня 1-е, факта ещё нет. */
  monthFact: IFinancePeriod | null;
  /** Дней с сегодня по конец месяца, включительно. */
  monthRemainingDays: number;
  year: number;
  /** Факт года, с 1 января по вчера; null — сегодня 1 января. */
  yearFact: IFinancePeriod | null;
  yearRemainingDays: number;
  /** Закрытые месяцы для динамики рентабельности, от старшего к младшему. */
  marginMonths: IFinancePeriod[];
}

export function forecastPlan(today: string, basisDays: TForecastBasisDays): IForecastPlan {
  const yesterday = shiftDay(today, -1);
  const year = Number(today.slice(0, 4));
  const monthNumber = Number(today.slice(5, 7));
  const month = monthPeriod(year, monthNumber);
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;

  const marginMonths: IFinancePeriod[] = [];
  for (let shift = FORECAST_MARGIN_MONTHS; shift >= 1; shift -= 1) {
    const index = year * 12 + monthNumber - 1 - shift;
    marginMonths.push(monthPeriod(Math.floor(index / 12), (index % 12) + 1));
  }

  return {
    today,
    basisDays,
    basis: { from: shiftDay(yesterday, -(basisDays - 1)), to: yesterday },
    month,
    monthFact: today === month.from ? null : { from: month.from, to: yesterday },
    monthRemainingDays: dayDiff(today, month.to) + 1,
    year,
    yearFact: today === yearFrom ? null : { from: yearFrom, to: yesterday },
    yearRemainingDays: dayDiff(today, yearTo) + 1,
    marginMonths,
  };
}

/** Готовые P&L периодов плана. Отчёт — то, что вернул `FinanceService.build`. */
export interface IForecastReport {
  pnl: IPnl;
  months: IPnlMonthStatus[];
}

export interface IForecastInput {
  plan: IForecastPlan;
  basis: IForecastReport;
  monthFact: IForecastReport | null;
  yearFact: IForecastReport | null;
  /** По одному на `plan.marginMonths`, в том же порядке. */
  marginMonths: IForecastReport[];
  receivable: { asOf: string; totalKopecks: number };
  /** Налоговые настройки — умолчание, продавец их не подтверждал. */
  taxIsDefault: boolean;
  /** Режим и ставка — для what-if: при «доходы минус расходы» комиссия уменьшает налог. */
  tax: IForecastTax;
}

export interface IForecastTax {
  regime: TTaxRegime;
  /** Сотые доли процента: 600 = 6 %. */
  rateBasisPoints: number;
}

export interface IForecastMarginPoint {
  /** ГГГГ-ММ. */
  month: string;
  kind: 'fact' | 'forecast';
  /** null — журнал месяца не загружен или выручки нет. */
  netMargin: number | null;
  revenueKopecks: number | null;
  netKopecks: number | null;
}

export interface IForecast {
  kind: 'forecast';
  today: string;
  method: {
    basisDays: TForecastBasisDays;
    basis: IFinancePeriod;
    /** Строка для экрана и модели — метод словами. */
    text: string;
  };
  /** Средний день окна базы. */
  daily: IForecastMetrics;
  month: {
    period: IFinancePeriod;
    /** Конец факта; null — сегодня 1-е. */
    factTo: string | null;
    remainingDays: number;
    fact: IForecastMetrics;
    forecast: IForecastMetrics;
    netMargin: number | null;
  };
  year: {
    year: number;
    remainingDays: number;
    fact: IForecastMetrics;
    forecast: IForecastMetrics;
  };
  /** Доля налога в выручке прогноза месяца; null — выручки нет. */
  taxShare: number | null;
  /** Доля возвратов в выручке окна (модуль); null — продаж нет. */
  returnsShare: number | null;
  inflow: {
    asOf: string;
    /** Начислено и ещё не выплачено на сегодня. */
    receivableKopecks: number;
    /** Прогноз начислений к перечислению с сегодня по конец месяца. */
    accrualsKopecks: number;
    totalKopecks: number;
  };
  margins: IForecastMarginPoint[];
  /** У части проданного в окне базы нет закупа — прогноз чистой завышен. */
  unconfirmed: IUnconfirmedProfit;
  taxIsDefault: boolean;
  tax: IForecastTax;
}

export type TForecastResult = { ok: true; forecast: IForecast } | { ok: false; reason: string };

const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const mmyyyy = (day: string) => `${day.slice(5, 7)}.${day.slice(0, 4)}`;

export function forecastMethodText(plan: IForecastPlan): string {
  return (
    `Линейно: факт с 1 числа по вчера плюс средний день за последние ${plan.basisDays} дн. ` +
    `(${ddmm(plan.basis.from)}–${ddmm(plan.basis.to)}) × оставшиеся дни. ` +
    'Чистая, налог, возвраты и начисления — в той же доле от выручки, что в этом окне. ' +
    'Сезонность, акции и рост не учитываются.'
  );
}

export const FORECAST_NO_JOURNAL = (month: string) =>
  `Журнал за ${month} не загружен — базы для прогноза нет`;
export const FORECAST_NO_SALES = (days: number) =>
  `За последние ${days} дн. продаж в журнале нет — прогнозировать не из чего`;

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function forecastOf(input: IForecastInput): TForecastResult {
  const { plan, basis } = input;
  const missing = basis.months.find((month) => month.status === null);
  if (missing) return { ok: false, reason: FORECAST_NO_JOURNAL(mmyyyy(missing.from)) };
  const windowSum = metricsOf(basis.pnl);
  if (windowSum.revenueKopecks <= 0)
    return { ok: false, reason: FORECAST_NO_SALES(plan.basisDays) };

  const monthFact = input.monthFact ? metricsOf(input.monthFact.pnl) : ZERO_METRICS;
  const yearFact = input.yearFact ? metricsOf(input.yearFact.pnl) : ZERO_METRICS;
  const month = project(monthFact, windowSum, plan.basisDays, plan.monthRemainingDays);
  const year = project(yearFact, windowSum, plan.basisDays, plan.yearRemainingDays);
  const accruals = Math.round(
    (windowSum.payableKopecks * plan.monthRemainingDays) / plan.basisDays,
  );
  const sales = basis.pnl.byArticle.sales.kopecks;

  const margins: IForecastMarginPoint[] = plan.marginMonths.map((period, index) => {
    const report = input.marginMonths[index];
    const loaded = report && report.months.every((m) => m.status !== null);
    return {
      month: period.from.slice(0, 7),
      kind: 'fact',
      netMargin: loaded ? report.pnl.netMargin : null,
      revenueKopecks: loaded ? report.pnl.revenueKopecks : null,
      netKopecks: loaded ? report.pnl.netKopecks : null,
    };
  });
  margins.push({
    month: plan.month.from.slice(0, 7),
    kind: 'forecast',
    netMargin: ratio(month.netKopecks, month.revenueKopecks),
    revenueKopecks: month.revenueKopecks,
    netKopecks: month.netKopecks,
  });

  return {
    ok: true,
    forecast: {
      kind: 'forecast',
      today: plan.today,
      method: { basisDays: plan.basisDays, basis: plan.basis, text: forecastMethodText(plan) },
      daily: project(ZERO_METRICS, windowSum, plan.basisDays, 1),
      month: {
        period: plan.month,
        factTo: plan.monthFact?.to ?? null,
        remainingDays: plan.monthRemainingDays,
        fact: monthFact,
        forecast: month,
        netMargin: ratio(month.netKopecks, month.revenueKopecks),
      },
      year: {
        year: plan.year,
        remainingDays: plan.yearRemainingDays,
        fact: yearFact,
        forecast: year,
      },
      taxShare: ratio(month.taxKopecks, month.revenueKopecks),
      returnsShare: ratio(Math.abs(windowSum.returnsKopecks), sales),
      inflow: {
        asOf: input.receivable.asOf,
        receivableKopecks: input.receivable.totalKopecks,
        accrualsKopecks: accruals,
        totalKopecks: input.receivable.totalKopecks + accruals,
      },
      margins,
      unconfirmed: basis.pnl.unconfirmed,
      taxIsDefault: input.taxIsDefault,
      tax: input.tax,
    },
  };
}

/** Строка бэктеста: прогноз выручки месяца, сделанный утром `cutDay`, против факта. */
export interface IBacktestRow {
  month: string;
  cutDay: number;
  basisDays: number;
  forecastKopecks: number;
  actualKopecks: number;
  /** |прогноз − факт| / факт; null — факта нет. */
  error: number | null;
}

export interface IBacktestSummary {
  basisDays: number;
  cutDay: number;
  /** Средняя абсолютная ошибка в долях; null — нет ни одного месяца с фактом. */
  mape: number | null;
  months: number;
}

/**
 * Бэктест того же правила на прошлых месяцах (критерий TASK-151): для месяца M и
 * дня отсечения c факт — Σ с 1-го по c−1, база — N дней перед c, прогноз —
 * `project` выручки. Окно базы может уходить в прошлый месяц — ряд обязан его
 * покрывать. Дни без продаж в ряду отсутствуют и считаются нулём.
 */
export function backtestOf(
  days: readonly { day: string; revenueKopecks: number }[],
  months: readonly IFinancePeriod[],
  cutDays: readonly number[],
  basisDays: readonly number[],
): { rows: IBacktestRow[]; summary: IBacktestSummary[] } {
  const byDay = new Map(days.map((d) => [d.day, d.revenueKopecks]));
  const sum = (from: string, to: string) => {
    let total = 0;
    for (let day = from; day <= to; day = shiftDay(day, 1)) total += byDay.get(day) ?? 0;
    return total;
  };

  const rows: IBacktestRow[] = [];
  for (const month of months) {
    const actual = sum(month.from, month.to);
    const length = dayDiff(month.from, month.to) + 1;
    for (const cut of cutDays) {
      if (cut < 2 || cut > length) continue;
      const cutIso = shiftDay(month.from, cut - 1);
      const yesterday = shiftDay(cutIso, -1);
      const fact = sum(month.from, yesterday);
      for (const n of basisDays) {
        const basis = sum(shiftDay(yesterday, -(n - 1)), yesterday);
        const forecast = fact + Math.round((basis * (length - cut + 1)) / n);
        rows.push({
          month: month.from.slice(0, 7),
          cutDay: cut,
          basisDays: n,
          forecastKopecks: forecast,
          actualKopecks: actual,
          error: actual > 0 ? Math.abs(forecast - actual) / actual : null,
        });
      }
    }
  }

  const summary: IBacktestSummary[] = [];
  for (const n of basisDays) {
    for (const cut of cutDays) {
      const errors = rows
        .filter((r) => r.basisDays === n && r.cutDay === cut && r.error !== null)
        .map((r) => r.error as number);
      summary.push({
        basisDays: n,
        cutDay: cut,
        mape: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
        months: errors.length,
      });
    }
  }
  return { rows, summary };
}
