/**
 * Налоговый модуль ИП за год (TASK-146, ТЗ п.12): доход с начала года, налог и
 * авансы по отчётным периодам, уменьшение на взносы с лимитом, уплачено,
 * прогноз года, предупреждения о лимитах и сверка с бухгалтерией. Чистые
 * функции — без Nest и базы; сборку входа делает `FinanceTaxYearService`.
 *
 * Своей формулы налога здесь нет. Доход и налог периода — `ITaxResult` из
 * `taxOf`, который считает P&L «Финансов» за тот же период (с 1 января по
 * конец периода), поэтому числа модуля совпадают с «Финансами» по построению,
 * и база — доход ДО комиссий площадки (`TAX_BASE_ARTICLES`).
 */

import type { ITaxResult } from './tax';
import type {
  ITaxReconciliationValue,
  ITaxYearParams,
  TTaxReductionKind,
  TTaxYearPeriod,
} from './tax-year.domain';
import type { ITaxSettings } from './tax.domain';

import { TAX_YEAR_PERIOD_END, TAX_YEAR_PERIODS } from './tax-year.domain';

export interface ITaxYearPeriodRange {
  key: TTaxYearPeriod;
  /** Всегда 1 января. */
  from: string;
  /** Конец периода, обрезанный сегодняшним днём. */
  to: string;
  /** Конец периода по закону. */
  fullTo: string;
  /** Период кончился — его числа больше не прирастают. */
  closed: boolean;
}

/**
 * Начавшиеся отчётные периоды года нарастающим итогом. Не начался год —
 * пустой список; идущий период обрезан сегодняшним днём.
 */
export function reportingPeriodsOf(year: number, today: string): ITaxYearPeriodRange[] {
  const from = `${year}-01-01`;
  if (today < from) return [];
  return TAX_YEAR_PERIODS.map((key) => {
    const fullTo = `${year}-${TAX_YEAR_PERIOD_END[key]}`;
    return { key, from, fullTo, to: fullTo < today ? fullTo : today, closed: fullTo < today };
  }).filter((period, index, all) => index === 0 || all[index - 1].closed);
}

/**
 * Пороги предупреждений — один объект с причиной у каждого числа (довод
 * `RATING_THRESHOLDS`): экран печатает их отсюда, своих копий нет.
 */
export const TAX_YEAR_THRESHOLDS = {
  /**
   * С какой доли лимита предупреждать. 80 % — запас на квартал при ровных
   * продажах: продавец успевает решить с бухгалтером до превышения, а не после.
   */
  approachShare: 0.8,
} as const;

export interface ITaxYearReduction {
  paidDay: string;
  kind: TTaxReductionKind;
  amountKopecks: number;
}

export interface ITaxYearPayment {
  paidDay: string;
  amountKopecks: number;
}

export interface ITaxYearReconciliation extends ITaxReconciliationValue {
  period: TTaxYearPeriod;
  checkedAt: Date | null;
}

export interface ITaxYearInput {
  year: number;
  today: string;
  settings: ITaxSettings;
  hasStaff: boolean;
  /** null — строки года в таблице нет. */
  params: ITaxYearParams | null;
  periods: readonly (ITaxYearPeriodRange & { tax: ITaxResult })[];
  reductions: readonly ITaxYearReduction[];
  /** Уплаты налога (раздел «Закупки») — день уплаты в пределах года. */
  payments: readonly ITaxYearPayment[];
  reconciliations: readonly ITaxYearReconciliation[];
}

export interface ITaxYearReconciliationView extends ITaxYearReconciliation {
  /** Наше − бухгалтерия; null — бухгалтер суммы не ввёл. */
  incomeDiffKopecks: number | null;
  taxDiffKopecks: number | null;
}

export interface ITaxYearPeriodResult extends ITaxYearPeriodRange {
  /** Доход с 1 января по конец периода — база ДО комиссий. */
  incomeKopecks: number;
  /** Налог нарастающим итогом до уменьшения. */
  taxKopecks: number;
  /** Минимальный налог применён — бывает только у года. */
  minimumApplied: boolean;
  /** Взносы, уплаченные с 1 января по конец периода. */
  reductionsPaidKopecks: number;
  /** Сколько из них уменьшило налог — не больше лимита. */
  reductionKopecks: number;
  /** Лимит уменьшения в копейках; null — уменьшение режимом не предусмотрено. */
  reductionLimitKopecks: number | null;
  /** Налог к уплате нарастающим итогом. */
  dueKopecks: number;
  /** Аванс (налог) периода: к уплате минус начисленное за прошлые периоды; < 0 — к зачёту. */
  advanceKopecks: number;
  undatedLines: number;
  reconciliation: ITaxYearReconciliationView | null;
}

export type TTaxYearWarningLevel = 'approaching' | 'forecast_exceeds' | 'exceeded' | 'info';

export interface ITaxYearWarning {
  key: string;
  level: TTaxYearWarningLevel;
  text: string;
}

export interface ITaxYearForecast {
  /** Всегда «прогноз»: экран обязан пометить число, а не выдать за факт. */
  kind: 'forecast';
  incomeKopecks: number;
  /** Сколько дней года легло в основу. */
  basisDays: number;
}

export interface ITaxYear {
  year: number;
  closed: boolean;
  periods: ITaxYearPeriodResult[];
  /** Доход с начала года (последний начавшийся период). */
  incomeKopecks: number;
  /** null — год закрыт (прогнозировать нечего) или не начался. */
  forecast: ITaxYearForecast | null;
  /** Уплачено налога в календарном году. */
  paidKopecks: number;
  /** К уплате на сегодня минус уплачено; < 0 — переплата. */
  balanceKopecks: number;
  warnings: ITaxYearWarning[];
}

const DAY_MS = 86_400_000;
const dayIndex = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** Дней с 1 января по `day` включительно. */
export function daysElapsed(year: number, day: string): number {
  return dayIndex(day) - dayIndex(`${year}-01-01`) + 1;
}

export function daysInYear(year: number): number {
  return daysElapsed(year, `${year}-12-31`);
}

/**
 * Прогноз годового дохода — линейно по дням: доход с начала года / прошедшие
 * дни × дни года. Сезонность не учитывается, поэтому это всегда «прогноз», и
 * экран так его и называет.
 */
export function forecastOf(
  year: number,
  incomeKopecks: number,
  today: string,
): ITaxYearForecast | null {
  if (today < `${year}-01-01` || today >= `${year}-12-31`) return null;
  const basisDays = daysElapsed(year, today);
  return {
    kind: 'forecast',
    incomeKopecks: Math.round((incomeKopecks * daysInYear(year)) / basisDays),
    basisDays,
  };
}

/** Копейки × сотые доли процента → копейки, округление одно. */
const share = (kopecks: number, basisPoints: number) =>
  Math.round((kopecks * basisPoints) / 10_000) + 0;

const rub = (kopecks: number) =>
  `${Math.round(kopecks / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;

const LIMITS = [
  {
    key: 'usn',
    field: 'usnIncomeLimitKopecks',
    title: 'лимит дохода УСН',
    consequence: 'с квартала превышения — общая система налогообложения',
  },
  {
    key: 'vat',
    field: 'vatThresholdKopecks',
    title: 'порог НДС',
    consequence: 'со следующего месяца после превышения — НДС',
  },
] as const;

/** Предупреждения: лимиты, ставка выше предельной года, параметры не заданы, строки без даты. */
export function taxYearWarningsOf(
  input: Pick<ITaxYearInput, 'year' | 'settings' | 'params'>,
  incomeKopecks: number,
  forecast: ITaxYearForecast | null,
  undatedLines: number,
): ITaxYearWarning[] {
  const warnings: ITaxYearWarning[] = [];
  const { params, settings, year } = input;
  if (!params) {
    warnings.push({
      key: 'params_missing',
      level: 'info',
      text: `Параметры ${year} года (лимит УСН, порог НДС, взносы) не заданы — предупреждений о лимитах нет`,
    });
  }
  for (const limit of LIMITS) {
    const value = params?.[limit.field] ?? null;
    if (value === null || value <= 0) continue;
    if (incomeKopecks > value) {
      warnings.push({
        key: `${limit.key}_exceeded`,
        level: 'exceeded',
        text: `Доход ${rub(incomeKopecks)} превысил ${limit.title} ${rub(value)}: ${limit.consequence}`,
      });
    } else if (incomeKopecks >= value * TAX_YEAR_THRESHOLDS.approachShare) {
      warnings.push({
        key: `${limit.key}_approaching`,
        level: 'approaching',
        text: `Доход ${rub(incomeKopecks)} — ${Math.floor((incomeKopecks / value) * 100)} % от ${limit.title} ${rub(value)}`,
      });
    } else if (forecast && forecast.incomeKopecks > value) {
      warnings.push({
        key: `${limit.key}_forecast`,
        level: 'forecast_exceeds',
        text: `По прогнозу доход за год — ${rub(forecast.incomeKopecks)}, выше ${limit.title} ${rub(value)}`,
      });
    }
  }
  const maxRate =
    settings.regime === 'usn_income'
      ? params?.maxRateUsnIncomeBasisPoints
      : params?.maxRateUsnIncomeMinusExpensesBasisPoints;
  if (maxRate !== null && maxRate !== undefined && settings.rateBasisPoints > maxRate) {
    warnings.push({
      key: 'rate_above_max',
      level: 'info',
      text: `Ставка ${settings.rateBasisPoints / 100} % выше предельной ${year} года — ${maxRate / 100} %`,
    });
  }
  if (undatedLines > 0) {
    warnings.push({
      key: 'undated',
      level: 'info',
      text: `${undatedLines} строк дохода без даты признания — в доход не вошли`,
    });
  }
  return warnings;
}

/**
 * Лимит уменьшения налога периода на взносы. Только УСН «Доходы»: без
 * работников — весь налог, с работниками — доля из параметров года. Строки
 * года нет — с работниками уменьшения нет (null-лимит → 0): завысить налог
 * безопаснее, чем занизить по угаданной доле.
 */
function reductionLimitOf(input: ITaxYearInput, taxKopecks: number): number | null {
  if (input.settings.regime !== 'usn_income') return null;
  if (!input.hasStaff) return taxKopecks;
  const bp = input.params?.reductionLimitWithStaffBasisPoints ?? null;
  return bp === null ? 0 : share(taxKopecks, bp);
}

function reconciliationOf(
  reconciliation: ITaxYearReconciliation | undefined,
  incomeKopecks: number,
  dueKopecks: number,
): ITaxYearReconciliationView | null {
  if (!reconciliation) return null;
  const diff = (ours: number, theirs: number | null) => (theirs === null ? null : ours - theirs);
  return {
    ...reconciliation,
    incomeDiffKopecks: diff(incomeKopecks, reconciliation.accountantIncomeKopecks),
    taxDiffKopecks: diff(dueKopecks, reconciliation.accountantTaxKopecks),
  };
}

export function taxYearOf(input: ITaxYearInput): ITaxYear {
  let previousDue = 0;
  let undated = 0;
  const periods = input.periods.map((period): ITaxYearPeriodResult => {
    // Минимальный налог УСН — годовой (ст. 346.18 НК): у авансов его нет.
    const isYear = period.key === 'y';
    const taxKopecks = isYear ? period.tax.taxKopecks : period.tax.regularKopecks;
    const reductionsPaidKopecks = input.reductions
      .filter((r) => r.paidDay >= period.from && r.paidDay <= period.fullTo)
      .reduce((sum, r) => sum + r.amountKopecks, 0);
    const reductionLimitKopecks = reductionLimitOf(input, taxKopecks);
    const reductionKopecks = Math.min(reductionsPaidKopecks, reductionLimitKopecks ?? 0);
    const dueKopecks = Math.max(taxKopecks - reductionKopecks, 0);
    const advanceKopecks = dueKopecks - previousDue;
    previousDue = dueKopecks;
    undated = Math.max(undated, period.tax.undatedLines);
    return {
      key: period.key,
      from: period.from,
      to: period.to,
      fullTo: period.fullTo,
      closed: period.closed,
      incomeKopecks: period.tax.incomeKopecks,
      taxKopecks,
      minimumApplied: isYear && period.tax.minimumApplied,
      reductionsPaidKopecks,
      reductionKopecks,
      reductionLimitKopecks,
      dueKopecks,
      advanceKopecks,
      undatedLines: period.tax.undatedLines,
      reconciliation: reconciliationOf(
        input.reconciliations.find((r) => r.period === period.key),
        period.tax.incomeKopecks,
        dueKopecks,
      ),
    };
  });

  const last = periods[periods.length - 1];
  const incomeKopecks = last?.incomeKopecks ?? 0;
  const closed = input.today > `${input.year}-12-31`;
  const forecast = closed ? null : forecastOf(input.year, incomeKopecks, input.today);
  const paidKopecks = input.payments
    .filter((p) => p.paidDay.startsWith(`${input.year}-`))
    .reduce((sum, p) => sum + p.amountKopecks, 0);

  return {
    year: input.year,
    closed,
    periods,
    incomeKopecks,
    forecast,
    paidKopecks,
    balanceKopecks: (last?.dueKopecks ?? 0) - paidKopecks,
    warnings: taxYearWarningsOf(input, incomeKopecks, forecast, undated),
  };
}
