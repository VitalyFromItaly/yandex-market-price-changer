/**
 * Налог за период (TASK-123, ТЗ п.12). Чистая функция — вход движка P&L
 * (TASK-120); уменьшение на взносы, авансы и годовой минимальный налог —
 * налоговый модуль TASK-146 (`tax-year.ts`) поверх этого же результата.
 *
 * База — доход продавца по реализации ДО комиссий, а не выплата площадки:
 * Маркет удерживает услуги из выручки, и налог от перечисленного занизил бы
 * его ровно на комиссию и логистику. Поэтому в базу идут только статьи
 * дохода, а удержания площадки не входят по построению.
 */

import type { TFinanceArticle } from './finance-articles';
import type { IFinancePeriod } from './finance-period';
import type { ITaxSettings } from './tax.domain';

import { USN_MINIMUM_TAX_BASIS_POINTS } from './tax.domain';

/**
 * Какие статьи журнала — налогооблагаемый доход. `Record`, а не список:
 * новая статья не скомпилируется, пока ей не решат, входит ли она в базу
 * (довод DRAFT_FIELD_SET). Возвраты входят со своим знаком — уменьшают доход.
 * Субсидии и компенсации — доход продавца (Маркет возмещает скидку), бонусные
 * списания — не деньги (`reference`).
 */
export const TAX_BASE_ARTICLES: Record<TFinanceArticle, boolean> = {
  sales: true,
  returns: true,
  compensations: true,
  subsidies: true,
  other_income: true,
  commission: false,
  delivery_to_buyer: false,
  reverse_logistics: false,
  acquiring: false,
  storage: false,
  acceptance: false,
  processing: false,
  promotion: false,
  paid_options: false,
  penalties: false,
  withholdings: false,
  subscription: false,
  other_services: false,
  bonus_payment: false,
  unknown: false,
};

/** Строка дохода: операция журнала со своими датами. Суммы — копейки со знаком. */
export interface ITaxRevenueLine {
  article: TFinanceArticle;
  amountKopecks: number;
  /** ГГГГ-ММ-ДД — день поступления денег; null — не известен. */
  paidDay: string | null;
  /** ГГГГ-ММ-ДД — день продажи/выкупа; null — не известен. */
  realizedDay: string | null;
}

export interface ITaxResult {
  /** Доход в периоде — Σ строк базы по выбранной дате признания. */
  incomeKopecks: number;
  /** Расходы к вычету (только «Доходы минус расходы»; у «Доходов» — 0). */
  deductibleKopecks: number;
  /** Налоговая база: доход или доход минус расходы, не меньше нуля. */
  baseKopecks: number;
  /** База × ставка. */
  regularKopecks: number;
  /** Минимальный налог (1 % дохода) — только «Доходы минус расходы». */
  minimumKopecks: number;
  /** Налог к начислению. */
  taxKopecks: number;
  minimumApplied: boolean;
  /**
   * Строки базы без даты нужного вида — в период не легли. Не молча: доход без
   * даты пропал бы из налога, и итог не сходился бы ни с чем без объяснения.
   */
  undatedLines: number;
}

/** Копейки × сотые доли процента → копейки; округление одно, на итог. */
function percentOf(kopecks: number, basisPoints: number): number {
  return Math.round((kopecks * basisPoints) / 10_000) + 0;
}

/**
 * Налог за период. `deductibleKopecks` — расходы к вычету, их собирает
 * вызывающий (P&L знает себестоимость, услуги и опер. расходы); у «Доходов»
 * они игнорируются.
 *
 * Минимальный налог по закону считается за год; за произвольный период
 * «Финансов» это оценка. Налоговый модуль ИП (TASK-146, `tax-year.ts`) берёт
 * его только у годового периода, у авансов — `regularKopecks`.
 */
export function taxOf(
  settings: ITaxSettings,
  lines: readonly ITaxRevenueLine[],
  period: IFinancePeriod,
  deductibleKopecks = 0,
): ITaxResult {
  let income = 0;
  let undated = 0;
  for (const line of lines) {
    if (!TAX_BASE_ARTICLES[line.article]) continue;
    const day = settings.recognition === 'payment' ? line.paidDay : line.realizedDay;
    if (!day) {
      undated += 1;
      continue;
    }
    // Строки «ГГГГ-ММ-ДД» сравниваются лексикографически — без Date.
    if (day < period.from || day > period.to) continue;
    income += line.amountKopecks;
  }

  const withExpenses = settings.regime === 'usn_income_minus_expenses';
  const deductible = withExpenses ? deductibleKopecks : 0;
  const base = Math.max(income - deductible, 0);
  const regular = percentOf(base, settings.rateBasisPoints);
  const minimum = withExpenses ? percentOf(Math.max(income, 0), USN_MINIMUM_TAX_BASIS_POINTS) : 0;
  const minimumApplied = withExpenses && minimum > regular;

  return {
    incomeKopecks: income,
    deductibleKopecks: deductible,
    baseKopecks: base,
    regularKopecks: regular,
    minimumKopecks: minimum,
    taxKopecks: minimumApplied ? minimum : regular,
    minimumApplied,
    undatedLines: undated,
  };
}
