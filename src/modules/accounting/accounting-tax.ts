/**
 * Налог нового учёта «Финучёта» (ТЗ п.6, TASK-221). Чистые функции — без Nest и I/O.
 *
 * Своей формулы налога здесь нет: налог периода — тот же `taxOf` (`finance/tax.ts`),
 * год с авансами, уменьшением на взносы и уплаченным — тот же `taxYearOf`
 * (`finance/tax-year.ts`). Различается только вход:
 *
 * - база — по всем площадкам аккаунта (журнал + ручные операции), а не по ЯМ;
 * - правило агентской базы выбирает продавец: валовая (умолчание, решение
 *   `accounting_tax_base_gross`) или нетто — за вычетом удержаний площадки;
 * - состав базы раскрыт до операций: продажи, возвраты, корректировки, субсидии,
 *   компенсации, прочие начисления, удержания (только «нетто»);
 * - строка Ozon/WB без даты выплаты при признании «по поступлению» берёт день
 *   начисления и считается отдельно (`accounting_tax_all_marketplaces`);
 * - вычеты «Доходы минус расходы» — услуги площадки, ручные расходы, опер.
 *   расходы и себестоимость v2; неизвестная закупка не вычитается и видна
 *   отдельно (`accounting_tax_deductible_v2`).
 *
 * Налог на заказ — доля налога периода по методике TASK-219 (`orderTaxItemOf` →
 * `allocateStoreCosts`), всегда `allocated` с пометкой «оценка, не обязательство».
 */

import type { TAccountingSubArticle } from './accounting-sub-articles';
import type { IStoreCostItem } from './store-cost-allocation';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceArticle } from '../finance/finance-articles';
import type { IFinancePeriod } from '../finance/finance-period';
import type { ITaxResult, ITaxRevenueLine } from '../finance/tax';
import type { ITaxYear, ITaxYearInput, ITaxYearPeriodRange } from '../finance/tax-year';
import type { ITaxSettings } from '../finance/tax.domain';

import { FINANCE_ARTICLE_KEYS, FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { TAX_BASE_ARTICLES, taxOf } from '../finance/tax';
import { taxYearOf } from '../finance/tax-year';

import { ORDER_TAX_ESTIMATE_NOTE } from './order-result';

/** Правило налоговой базы при продаже через площадку-агента. */
export type TTaxBaseRule = 'gross' | 'net';

export const TAX_BASE_RULE_TITLE: Record<TTaxBaseRule, string> = {
  gross: 'Вся сумма от покупателя (валовая)',
  net: 'За вычетом удержаний площадки (нетто)',
};

export const TAX_BASE_RULE_HINT: Record<TTaxBaseRule, string> = {
  gross:
    'Доход — всё, что заплатил покупатель, и доплаты площадки. Комиссии и услуги площадки базу не уменьшают.',
  net: 'Доход — сумма к перечислению: из выручки вычтены комиссии, логистика и прочие удержания площадки.',
};

/** Нет строки настроек — валовая (решение `accounting_tax_base_gross`). */
export const DEFAULT_TAX_BASE_RULE: TTaxBaseRule = 'gross';

export function isTaxBaseRule(value: unknown): value is TTaxBaseRule {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(TAX_BASE_RULE_TITLE, value)
  );
}

const inPeriod = (day: string, period: IFinancePeriod) => day >= period.from && day <= period.to;

const isExpense = (article: TFinanceArticle) => FINANCE_ARTICLE_META[article].group === 'expense';

/**
 * Облагаемые статьи по правилу. Валовая — ровно `TAX_BASE_ARTICLES` P&L (второго
 * списка нет); нетто — плюс расходы площадки со своим знаком. Нераспознанное и
 * справочное не облагаются ни при каком правиле, как в P&L.
 */
export const TAX_BASE_ARTICLES_BY_RULE: Record<
  TTaxBaseRule,
  Readonly<Record<TFinanceArticle, boolean>>
> = {
  gross: TAX_BASE_ARTICLES,
  net: Object.fromEntries(
    FINANCE_ARTICLE_KEYS.map((key) => [key, TAX_BASE_ARTICLES[key] || isExpense(key)]),
  ) as Record<TFinanceArticle, boolean>,
};

/**
 * Есть ли в журнале площадки день поступления денег (`paidAt`). У Ozon и WB его
 * нет (решение `compare_tax_by_accrual`): при признании «по поступлению» их
 * строки иначе не легли бы ни в один период, и налог был бы занижен.
 */
export const JOURNAL_HAS_PAID_AT: Record<TFinanceMarketplace, boolean> = {
  ym: true,
  ozon: false,
  wb: false,
};

export const PAID_DAY_FALLBACK_NOTE = 'Дата поступления неизвестна — взята дата начисления';

/** Составляющая налоговой базы — строка раскрытия на экране. */
export type TTaxBaseComponent =
  | 'sales'
  | 'returns'
  | 'corrections'
  | 'subsidies'
  | 'compensations'
  | 'other_income'
  | 'marketplace_withheld';

export const TAX_BASE_COMPONENT_TITLE: Record<TTaxBaseComponent, string> = {
  sales: 'Продажи',
  returns: 'Возвраты покупателям',
  corrections: 'Корректировки базы',
  subsidies: 'Субсидии площадки',
  compensations: 'Компенсации',
  other_income: 'Прочие начисления',
  marketplace_withheld: 'Удержания площадки',
};

const COMPONENT_ORDER = Object.keys(TAX_BASE_COMPONENT_TITLE) as TTaxBaseComponent[];

/**
 * Статья → составляющая. `Record` по всем статьям: новая статья не скомпилируется,
 * пока ей не решат место. `null` — не облагается ни при каком правиле.
 */
const COMPONENT_OF_ARTICLE: Record<TFinanceArticle, TTaxBaseComponent | null> = {
  sales: 'sales',
  returns: 'returns',
  subsidies: 'subsidies',
  compensations: 'compensations',
  other_income: 'other_income',
  commission: 'marketplace_withheld',
  delivery_to_buyer: 'marketplace_withheld',
  reverse_logistics: 'marketplace_withheld',
  acquiring: 'marketplace_withheld',
  storage: 'marketplace_withheld',
  acceptance: 'marketplace_withheld',
  processing: 'marketplace_withheld',
  promotion: 'marketplace_withheld',
  paid_options: 'marketplace_withheld',
  penalties: 'marketplace_withheld',
  withholdings: 'marketplace_withheld',
  subscription: 'marketplace_withheld',
  other_services: 'marketplace_withheld',
  bonus_payment: null,
  promotion_report: null,
  unknown: null,
};

/** Подстатьи журнала, которые площадка сама называет корректировкой продажи. */
const CORRECTION_SUB_ARTICLES: ReadonlySet<TAccountingSubArticle> = new Set<TAccountingSubArticle>([
  'sale_correction',
  'storno',
]);

/** Операция журнала для налога: московские дни уже посчитаны. */
export interface ITaxJournalOperation {
  id: string;
  marketplace: TFinanceMarketplace;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  amountKopecks: number;
  /** ГГГГ-ММ-ДД — день начисления. */
  accruedDay: string;
  /** ГГГГ-ММ-ДД — день выплаты; null — не выплачено или площадка его не даёт. */
  paidDay: string | null;
}

/** Ручная операция «Финучёта» (TASK-208): у неё одна дата — день начисления. */
export interface ITaxManualOperation {
  id: string;
  marketplace: TFinanceMarketplace;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  amountKopecks: number;
  accruedOn: string;
}

/** Строка налоговой базы. */
export interface ITaxBaseItem {
  id: string;
  origin: 'journal' | 'manual';
  marketplace: TFinanceMarketplace;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  component: TTaxBaseComponent;
  amountKopecks: number;
  paidDay: string | null;
  realizedDay: string | null;
  /** День поступления подставлен днём начисления: у площадки нет `paidAt`. */
  paidDayFallback: boolean;
}

function componentOf(
  article: TFinanceArticle,
  subArticle: TAccountingSubArticle | null,
  origin: ITaxBaseItem['origin'],
): TTaxBaseComponent | null {
  const component = COMPONENT_OF_ARTICLE[article];
  if (component === null) return null;
  // Ручная операция дохода — всегда правка базы человеком, а не продажа площадки.
  if (component !== 'marketplace_withheld' && origin === 'manual') return 'corrections';
  if (subArticle && CORRECTION_SUB_ARTICLES.has(subArticle)) return 'corrections';
  return component;
}

/**
 * Строки базы по правилу. Ручная операция датирована одним днём, который ввёл
 * продавец: он же — день поступления и реализации. Строка Ozon/WB без выплаты —
 * день начисления с пометкой; строка ЯМ без выплаты остаётся без даты поступления
 * (деньги ещё не пришли — `taxOf` посчитает её в `undatedLines`).
 */
export function taxBaseItemsOf(
  journal: readonly ITaxJournalOperation[],
  manual: readonly ITaxManualOperation[],
  rule: TTaxBaseRule,
): ITaxBaseItem[] {
  const articles = TAX_BASE_ARTICLES_BY_RULE[rule];
  const items: ITaxBaseItem[] = [];
  for (const op of journal) {
    if (!articles[op.article]) continue;
    const component = componentOf(op.article, op.subArticle, 'journal');
    if (!component) continue;
    const fallback = op.paidDay === null && !JOURNAL_HAS_PAID_AT[op.marketplace];
    items.push({
      id: op.id,
      origin: 'journal',
      marketplace: op.marketplace,
      article: op.article,
      subArticle: op.subArticle,
      component,
      amountKopecks: op.amountKopecks,
      paidDay: fallback ? op.accruedDay : op.paidDay,
      realizedDay: op.accruedDay,
      paidDayFallback: fallback,
    });
  }
  for (const op of manual) {
    if (!articles[op.article]) continue;
    const component = componentOf(op.article, op.subArticle, 'manual');
    if (!component) continue;
    items.push({
      id: op.id,
      origin: 'manual',
      marketplace: op.marketplace,
      article: op.article,
      subArticle: op.subArticle,
      component,
      amountKopecks: op.amountKopecks,
      paidDay: op.accruedOn,
      realizedDay: op.accruedOn,
      paidDayFallback: false,
    });
  }
  return items;
}

/** Себестоимость v2 проданного за период (`AccountingCogsService`). */
export interface ITaxCogs {
  /** Σ известной себестоимости, копейки, «+» — расход (возврат товара уменьшает). */
  kopecks: number;
  /** Строки, двигающие товар, без закупа на момент продажи — не вычтены. */
  unknown: { count: number; operationIds: string[] };
}

/** Строка журнала, двигающая товар, — как её видит себестоимость P&L (`pnlLineOf`). */
export interface ITaxCogsLine {
  id: string;
  /** `sold` — продажа (расход «+»), иначе — возврат товара (уменьшает). */
  goods: 'sold' | 'returned' | null;
  count: number | null;
  accruedDay: string;
}

/**
 * Себестоимость v2 строк периода по дню начисления — то же правило знака, что
 * `cogsOf` P&L. `costOf` — себестоимость ВСЕХ штук строки, копейки «+» (режим А —
 * закуп единицы × штуки, режим Б — сумма партий FIFO); `null` — неизвестна:
 * строка не вычитается и попадает в `unknown` (не 0, `accounting_unknown_cost_strict`).
 */
export function taxCogsOf(
  lines: readonly ITaxCogsLine[],
  period: IFinancePeriod,
  costOf: (line: ITaxCogsLine) => number | null,
): ITaxCogs {
  let kopecks = 0;
  const unknown = { count: 0, operationIds: [] as string[] };
  for (const line of lines) {
    if (!line.goods || !inPeriod(line.accruedDay, period)) continue;
    const cost = line.count !== null && line.count > 0 ? costOf(line) : null;
    if (cost === null || !Number.isFinite(cost)) {
      unknown.count += 1;
      unknown.operationIds.push(line.id);
      continue;
    }
    kopecks += (line.goods === 'sold' ? 1 : -1) * cost;
  }
  return { kopecks: kopecks + 0, unknown };
}

export interface IAccountingTaxInput {
  settings: ITaxSettings;
  rule: TTaxBaseRule;
  period: IFinancePeriod;
  journal: readonly ITaxJournalOperation[];
  manual: readonly ITaxManualOperation[];
  /** Опер. расходы периода (`FinanceExpensesService.allocatedFor`), «+» — расход. */
  opexKopecks: number;
  /** null — не считалась (режим «Доходы»: вычетов нет). */
  cogs: ITaxCogs | null;
}

export interface ITaxBaseComposition {
  component: TTaxBaseComponent;
  title: string;
  kopecks: number;
  count: number;
  operationIds: string[];
}

export interface ITaxBaseByMarketplace {
  marketplace: TFinanceMarketplace;
  kopecks: number;
  count: number;
}

export interface ITaxDeductible {
  /** Вычеты применяются — режим «Доходы минус расходы». */
  applies: boolean;
  /** Услуги площадки из журнала; при правиле «нетто» — 0: они уже уменьшили доход. */
  marketplaceServicesKopecks: number;
  /** Ручные операции расходов; при «нетто» — 0 по той же причине. */
  manualExpensesKopecks: number;
  opexKopecks: number;
  cogsKopecks: number;
  unknownCogs: { count: number; operationIds: string[] };
  /** То, что ушло в `taxOf`: Σ вычетов, не меньше нуля. */
  totalKopecks: number;
}

export interface IAccountingTax {
  period: IFinancePeriod;
  rule: TTaxBaseRule;
  ruleTitle: string;
  settings: ITaxSettings;
  /** Тот же результат `taxOf`, что у P&L: доход, вычеты, база, налог, минимальный. */
  tax: ITaxResult;
  /** Состав дохода; Σ `kopecks` = `tax.incomeKopecks`. */
  composition: ITaxBaseComposition[];
  byMarketplace: ITaxBaseByMarketplace[];
  deductible: ITaxDeductible;
  /** Строк базы в периоде с подставленной датой поступления. */
  paidDayFallbackLines: number;
  /** Строки базы без даты признания — в доход не вошли (`tax.undatedLines` поштучно). */
  undatedOperationIds: string[];
}

/** Σ «+»-расходов статей группы expense, начисленных в периоде. */
function expensesIn(
  ops: readonly { article: TFinanceArticle; amountKopecks: number; day: string }[],
  period: IFinancePeriod,
): number {
  let total = 0;
  for (const op of ops) {
    if (isExpense(op.article) && inPeriod(op.day, period)) total -= op.amountKopecks;
  }
  return total + 0;
}

function deductibleOf(input: IAccountingTaxInput): ITaxDeductible {
  const applies = input.settings.regime === 'usn_income_minus_expenses';
  const unknownCogs = input.cogs?.unknown ?? { count: 0, operationIds: [] };
  if (!applies) {
    return {
      applies,
      marketplaceServicesKopecks: 0,
      manualExpensesKopecks: 0,
      opexKopecks: 0,
      cogsKopecks: 0,
      unknownCogs: { count: 0, operationIds: [] },
      totalKopecks: 0,
    };
  }
  // «Нетто»: удержания уже вычтены из дохода — второй раз вычетом их не берём.
  const gross = input.rule === 'gross';
  const marketplaceServicesKopecks = gross
    ? expensesIn(
        input.journal.map((op) => ({ ...op, day: op.accruedDay })),
        input.period,
      )
    : 0;
  const manualExpensesKopecks = gross
    ? expensesIn(
        input.manual.map((op) => ({ ...op, day: op.accruedOn })),
        input.period,
      )
    : 0;
  const cogsKopecks = input.cogs?.kopecks ?? 0;
  const total =
    marketplaceServicesKopecks + manualExpensesKopecks + input.opexKopecks + cogsKopecks;
  return {
    applies,
    marketplaceServicesKopecks,
    manualExpensesKopecks,
    opexKopecks: input.opexKopecks,
    cogsKopecks,
    unknownCogs,
    totalKopecks: Math.max(total, 0),
  };
}

/** Налог «Финучёта» за период: тот же `taxOf`, вход — по правилу агентской базы. */
export function accountingTaxOf(input: IAccountingTaxInput): IAccountingTax {
  const { settings, rule, period } = input;
  const items = taxBaseItemsOf(input.journal, input.manual, rule);
  const deductible = deductibleOf(input);

  const lines: ITaxRevenueLine[] = items.map((item) => ({
    article: item.article,
    amountKopecks: item.amountKopecks,
    paidDay: item.paidDay,
    realizedDay: item.realizedDay,
  }));
  const tax = taxOf(
    settings,
    lines,
    period,
    deductible.totalKopecks,
    TAX_BASE_ARTICLES_BY_RULE[rule],
  );

  // Тот же отбор по дате признания, что внутри `taxOf`: состав сходится с доходом.
  const byComponent = new Map<TTaxBaseComponent, ITaxBaseComposition>();
  const byMarketplace = new Map<TFinanceMarketplace, ITaxBaseByMarketplace>();
  const undatedOperationIds: string[] = [];
  let paidDayFallbackLines = 0;
  for (const item of items) {
    const day = settings.recognition === 'payment' ? item.paidDay : item.realizedDay;
    if (!day) {
      undatedOperationIds.push(item.id);
      continue;
    }
    if (!inPeriod(day, period)) continue;
    if (settings.recognition === 'payment' && item.paidDayFallback) paidDayFallbackLines += 1;
    const entry = byComponent.get(item.component) ?? {
      component: item.component,
      title: TAX_BASE_COMPONENT_TITLE[item.component],
      kopecks: 0,
      count: 0,
      operationIds: [],
    };
    entry.kopecks += item.amountKopecks;
    entry.count += 1;
    if (!entry.operationIds.includes(item.id)) entry.operationIds.push(item.id);
    byComponent.set(item.component, entry);
    const own = byMarketplace.get(item.marketplace) ?? {
      marketplace: item.marketplace,
      kopecks: 0,
      count: 0,
    };
    own.kopecks += item.amountKopecks;
    own.count += 1;
    byMarketplace.set(item.marketplace, own);
  }

  return {
    period,
    rule,
    ruleTitle: TAX_BASE_RULE_TITLE[rule],
    settings,
    tax,
    composition: COMPONENT_ORDER.filter((key) => byComponent.has(key)).map((key) =>
      byComponent.get(key),
    ),
    byMarketplace: [...byMarketplace.values()],
    deductible,
    paidDayFallbackLines,
    undatedOperationIds,
  };
}

export interface IAccountingTaxYearPeriod extends ITaxYearPeriodRange {
  /** Налог «Финучёта» с 1 января по конец периода. */
  accounting: IAccountingTax;
}

export type TAccountingTaxYearInput = Omit<ITaxYearInput, 'periods'> & {
  periods: readonly IAccountingTaxYearPeriod[];
};

export interface IAccountingTaxYear {
  /** Начислено, к уплате, авансы, уплачено и остаток — тот же `taxYearOf`. */
  taxYear: ITaxYear;
  /** Раскрытие базы каждого отчётного периода — в порядке `taxYear.periods`. */
  periods: IAccountingTaxYearPeriod[];
}

/**
 * Год по отчётным периодам УСН нарастающим итогом (`tax_year_reporting_periods`):
 * начисленный налог и авансы — `taxYearOf` поверх налога «Финучёта» каждого
 * периода, уплаченный — ручные уплаты продавца (`finance_tax_payments`).
 */
export function accountingTaxYearOf(input: TAccountingTaxYearInput): IAccountingTaxYear {
  const taxYear = taxYearOf({
    ...input,
    periods: input.periods.map(({ accounting, ...range }) => ({ ...range, tax: accounting.tax })),
  });
  return { taxYear, periods: [...input.periods] };
}

/**
 * Налог периода как общий расход для распределения по заказам (TASK-219). Ноль —
 * распределять нечего, `null`. Обязательство остаётся у периода: доли заказов —
 * оценка, их пометка — `ORDER_TAX_ESTIMATE_NOTE`.
 */
export function orderTaxItemOf(tax: IAccountingTax): IStoreCostItem | null {
  if (tax.tax.taxKopecks === 0) return null;
  return {
    id: `tax:${tax.period.from}:${tax.period.to}`,
    kind: 'tax',
    kopecks: -tax.tax.taxKopecks,
    title: `Налог периода (${ORDER_TAX_ESTIMATE_NOTE.toLowerCase()})`,
    accruedOn: tax.period.to,
    source: 'tax',
  };
}
