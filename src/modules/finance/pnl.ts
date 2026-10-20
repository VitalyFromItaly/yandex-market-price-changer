/**
 * P&L периода из журнала операций площадки (TASK-120, ТЗ п.3). Чистая функция —
 * без Nest и базы; данные собирает `FinanceService`.
 *
 * Формула ТЗ: выручка от реализованных + прочие доходы − себестоимость
 * проданного − услуги площадки − операционные расходы − налог. Уровни —
 * валовая, после расходов площадки, операционная, чистая.
 *
 * Σ статей = чистая ПО ПОСТРОЕНИЮ: один проход копит корзины статей и
 * себестоимость, а уровни складываются только из этих корзин — не из
 * параллельных фильтров по тем же строкам (довод `IReturnsSummary.records`).
 *
 * Правила (решения `pnl_*` в tasks.json):
 * - в период строка попадает по дню НАЧИСЛЕНИЯ (`pnl_accrual_date`); налог —
 *   по своей дате признания, `taxOf` фильтрует сам, поэтому ему отдаются ВСЕ
 *   строки входа, в том числе оплаченные в периоде, но начисленные раньше;
 * - себестоимость — по строкам, которые двигают товар (`ymGoodsMovement`, у
 *   Ozon — `ozonGoodsMovement` по части выручки), на день строки продажи (`pnl_cogs_sale_day`); закупка партии в журнале не
 *   бывает, поэтому в P&L не попадает по построению;
 * - продажа без закупа на дату остаётся в выручке, позиция — в
 *   `cogs.unknown`, а `unconfirmed` говорит, сколько заказов и на какую сумму
 *   продано без закупа: чистая завышена (`pnl_unknown_cost_keeps_revenue`,
 *   `profit_unconfirmed_flag_only`);
 * - `unknown` — отдельной строкой в чистой, вне налога; `bonus_payment` —
 *   справочно, вне уровней (`pnl_unknown_article_in_net`).
 *
 * Деньги — целые копейки со знаком площадки: «+» продавцу, «−» удержание.
 */

import type { IExpenseAllocation } from './expense-allocation';
import type { TFinanceArticle } from './finance-articles';
import type { IFinancePeriod } from './finance-period';
import type { IPnlSalesDay, IPnlSkuSalesDay } from './pnl-sales';
import type { IPnlSkuBreakdown } from './pnl-sku';
import type { ITaxResult, ITaxRevenueLine } from './tax';
import type { ITaxSettings } from './tax.domain';
import type { TYmGoodsMovement } from './ym-articles';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IUnconfirmedProfit } from '../../shared/profit-confirmation';

import { unconfirmedOf } from '../../shared/profit-confirmation';

import { FINANCE_ARTICLE_KEYS } from './finance-articles';
import { financeToday } from './finance-period';
import { ozonGoodsMovement } from './ozon-articles';
import { salesByDayOf, skuSalesByDayOf } from './pnl-sales';
import { skuBreakdownOf } from './pnl-sku';
import { taxOf } from './tax';
import { wbGoodsMovement } from './wb-articles';
import { ymGoodsMovement } from './ym-articles';

/** Строка журнала в объёме, нужном P&L. */
export interface IPnlLine {
  /** id операции в finance_operations — раскрытие цифры до строк. */
  id: string;
  article: TFinanceArticle;
  amountKopecks: number;
  /** Номер заказа; по нему считается число заказов периода. Нет — строка без заказа. */
  orderId?: string | null;
  sku: string | null;
  /** Штук в строке; null — неизвестно (себестоимость тогда не считается). */
  count: number | null;
  goods: TYmGoodsMovement;
  /** ГГГГ-ММ-ДД по Москве — день начисления. */
  accruedDay: string;
  /** ГГГГ-ММ-ДД по Москве — день выплаты; null — не выплачено. */
  paidDay: string | null;
  /** Схема работы строки (у ЯМ — FBS/FBY); null — площадка не сказала. Нет — как null. */
  scheme?: string | null;
}

/** Операция журнала, как её читает `FinanceOperationRepository.liveForPnl`. */
export interface IPnlOperation {
  id: string;
  article: TFinanceArticle;
  amountKopecks: number;
  orderId: string | null;
  sku: string | null;
  serviceName: string | null;
  transactionType: string;
  transactionSource: string | null;
  accruedAt: Date;
  paidAt: Date | null;
  actDate: Date | null;
  /** Схема (`model` отчёта: FBS/FBY); null — пусто. Нет поля — старый вызов, как null. */
  model?: string | null;
  /** `count` сырой строки отчёта — как пришёл, строкой; колонки у него нет. */
  count: string | null;
  /** Площадка строки; нет — ЯМ (вызовы до TASK-131). Решает, чьё правило движения товара. */
  marketplace?: TFinanceMarketplace;
}

/** Штуки из сырой строки: только целое > 0, иначе null — себестоимость не угадываем. */
export function countOf(value: string | null): number | null {
  const n = Number(value);
  return value !== null && value !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/** Движение товара — по правилу площадки строки; нет площадки — ЯМ. */
function goodsMovementOf(op: IPnlOperation): IPnlLine['goods'] {
  if (op.marketplace === 'ozon') return ozonGoodsMovement(op.transactionType, op.article);
  if (op.marketplace === 'wb') return wbGoodsMovement(op.transactionType, op.article);
  return ymGoodsMovement(op.transactionType, op.transactionSource);
}

/** Операция → строка P&L. Дни — московские (`financeToday` от момента). */
export function pnlLineOf(op: IPnlOperation): IPnlLine {
  return {
    id: op.id,
    article: op.article,
    amountKopecks: op.amountKopecks,
    orderId: op.orderId,
    sku: op.sku,
    count: countOf(op.count),
    goods: goodsMovementOf(op),
    accruedDay: financeToday(op.accruedAt),
    paidDay: op.paidAt ? financeToday(op.paidAt) : null,
    scheme: op.model || null,
  };
}

/** Закуп одной штуки артикула в день, копейки; undefined — неизвестен. */
export type TPnlCostOf = (sku: string, day: string) => number | undefined;

/** Раздел отчёта, куда идёт статья. */
export type TPnlSection = 'revenue' | 'other_income' | 'marketplace' | 'unrecognized' | 'reference';

/**
 * Статья → раздел. `Record`, а не список: новая статья не скомпилируется без
 * решения, где она в P&L (довод DRAFT_FIELD_SET). Тест сверяет с группами
 * `FINANCE_ARTICLE_META`: доходы — только в revenue/other_income, расходы — в
 * marketplace.
 */
export const PNL_SECTION: Record<TFinanceArticle, TPnlSection> = {
  sales: 'revenue',
  // Возврат платежа и возврат баллов — сторно продажи и субсидии.
  returns: 'revenue',
  subsidies: 'revenue',
  compensations: 'other_income',
  other_income: 'other_income',
  commission: 'marketplace',
  delivery_to_buyer: 'marketplace',
  reverse_logistics: 'marketplace',
  acquiring: 'marketplace',
  storage: 'marketplace',
  acceptance: 'marketplace',
  processing: 'marketplace',
  promotion: 'marketplace',
  paid_options: 'marketplace',
  penalties: 'marketplace',
  withholdings: 'marketplace',
  subscription: 'marketplace',
  other_services: 'marketplace',
  bonus_payment: 'reference',
  unknown: 'unrecognized',
};

/** Порядок разделов на экране и их подписи — одна таблица на CRM и скрипт сверки. */
export const PNL_SECTION_ORDER: readonly TPnlSection[] = [
  'revenue',
  'other_income',
  'marketplace',
  'unrecognized',
  'reference',
];

export const PNL_SECTION_TITLE: Readonly<Record<TPnlSection, string>> = {
  revenue: 'Выручка',
  other_income: 'Прочие доходы',
  marketplace: 'Расходы площадки',
  unrecognized: 'Не распознано',
  reference: 'Справочно — не деньги',
};

export interface IPnlBucket {
  kopecks: number;
  operationIds: string[];
}

export interface IPnlCogsSku {
  sku: string;
  /** Продано минус вернулось, штук. */
  count: number;
  kopecks: number;
  operationIds: string[];
}

export interface IPnlCogsUnknown {
  /** Пустая строка — у строки журнала нет артикула. */
  sku: string;
  count: number;
  operationIds: string[];
}

export interface IPnlCogs {
  /** Себестоимость проданного за вычетом вернувшегося, копейки (≥ 0 обычно). */
  kopecks: number;
  bySku: IPnlCogsSku[];
  /** Позиции без закупа на дату или без числа штук — себестоимость не учтена. */
  unknown: IPnlCogsUnknown[];
}

export interface IPnlInput {
  lines: readonly IPnlLine[];
  period: IFinancePeriod;
  costOf: TPnlCostOf;
  expenses: IExpenseAllocation;
  tax: ITaxSettings;
}

export interface IPnl {
  period: IFinancePeriod;
  /** Все статьи; в уровни идут по `PNL_SECTION`. Только строки, начисленные в периоде. */
  byArticle: Record<TFinanceArticle, IPnlBucket>;
  /** Продажи + субсидии + возвраты. */
  revenueKopecks: number;
  /** Компенсации + прочие начисления. */
  otherIncomeKopecks: number;
  cogs: IPnlCogs;
  /**
   * Различных заказов со строкой продажи в периоде (TASK-125). Считается тем же
   * проходом, что корзины, — средний чек = выручка / заказы сходится с выручкой.
   */
  ordersCount: number;
  /** Штук продано минус вернулось — из той же себестоимости, включая позиции без закупа. */
  units: number;
  /** Выручка + прочие доходы − себестоимость. */
  grossKopecks: number;
  /** Σ услуг и удержаний площадки, со знаком площадки (обычно < 0). */
  marketplaceKopecks: number;
  /** Σ строк без статьи — деньги движутся, поэтому в чистой; в налог не идут. */
  unrecognizedKopecks: number;
  /** Валовая + расходы площадки + нераспознанное. */
  afterMarketplaceKopecks: number;
  operatingExpenses: IExpenseAllocation;
  /** После площадки − операционные расходы. */
  operatingKopecks: number;
  tax: ITaxResult;
  /** Операционная − налог. */
  netKopecks: number;
  /** Валовая / выручка; null — выручки нет. */
  grossMargin: number | null;
  /** Чистая / выручка; null — выручки нет. */
  netMargin: number | null;
  /** Справочно (оплачено баллами) — в уровни не входит. */
  reference: IPnlBucket;
  /**
   * Прибыль не подтверждена (TASK-119): у части проданного нет себестоимости на
   * дату, чистая завышена. Выручка остаётся (`pnl_unknown_cost_keeps_revenue`),
   * признак называет заказы и их продажи. Экраны его печатают, а не вычисляют.
   */
  unconfirmed: IUnconfirmedProfit;
  /**
   * Unit-экономика (TASK-138): те же строки и та же себестоимость по товарам.
   * Σ чистой товаров + `rest.netKopecks` = `netKopecks` по построению.
   */
  skus: IPnlSkuBreakdown;
  /**
   * Продажи по дням (TASK-140): выручка, штуки и заказы из тех же строк. Σ дней =
   * `revenueKopecks` / `units` / `ordersCount` по построению (`pnl-sales.ts`).
   */
  salesByDay: IPnlSalesDay[];
  /**
   * Штуки по артикулам и дням (TASK-141, XYZ): Σ дней артикула = его `units` в
   * `skus` по построению. Только строки с артикулом.
   */
  skuSalesByDay: IPnlSkuSalesDay[];
}

const inPeriod = (day: string, period: IFinancePeriod) => day >= period.from && day <= period.to;

const validCount = (count: number | null): count is number =>
  typeof count === 'number' && Number.isInteger(count) && count > 0;

function emptyBuckets(): Record<TFinanceArticle, IPnlBucket> {
  const buckets = {} as Record<TFinanceArticle, IPnlBucket>;
  for (const key of FINANCE_ARTICLE_KEYS) buckets[key] = { kopecks: 0, operationIds: [] };
  return buckets;
}

function sectionSum(buckets: Record<TFinanceArticle, IPnlBucket>, section: TPnlSection): number {
  let sum = 0;
  for (const key of FINANCE_ARTICLE_KEYS) {
    if (PNL_SECTION[key] === section) sum += buckets[key].kopecks;
  }
  return sum;
}

/** Строки дохода для `taxOf`: день признания по выплате — paidDay, по реализации — день начисления. */
export function taxLinesOf(lines: readonly IPnlLine[]): ITaxRevenueLine[] {
  return lines.map((line) => ({
    article: line.article,
    amountKopecks: line.amountKopecks,
    paidDay: line.paidDay,
    realizedDay: line.accruedDay,
  }));
}

export interface ICogsPass {
  cogs: IPnlCogs;
  /** Себестоимость каждой учтённой строки — для разреза по товарам. */
  lineCogs: Map<string, number>;
  /** Штуки каждой строки, двигающей товар, со знаком — из них же `units`. */
  lineUnits: Map<string, number>;
  unknownCostLines: Set<string>;
}

/**
 * Себестоимость строк, двигающих товар, — один проход. Экспортирована для
 * прибыли заказа (TASK-144): у заказа то же правило, что у P&L.
 */
export function cogsOf(lines: readonly IPnlLine[], costOf: TPnlCostOf): ICogsPass {
  const bySku = new Map<string, IPnlCogsSku>();
  const unknown = new Map<string, IPnlCogsUnknown>();
  const lineCogs = new Map<string, number>();
  const lineUnits = new Map<string, number>();
  const unknownCostLines = new Set<string>();
  let total = 0;

  for (const line of lines) {
    if (!line.goods) continue;
    const sign = line.goods === 'sold' ? 1 : -1;
    const sku = line.sku ?? '';
    const unit = sku && validCount(line.count) ? costOf(sku, line.accruedDay) : undefined;
    lineUnits.set(line.id, sign * (validCount(line.count) ? line.count : 0));

    if (unit === undefined || !Number.isFinite(unit)) {
      const entry = unknown.get(sku) ?? { sku, count: 0, operationIds: [] };
      entry.count += sign * (validCount(line.count) ? line.count : 0);
      entry.operationIds.push(line.id);
      unknown.set(sku, entry);
      unknownCostLines.add(line.id);
      continue;
    }

    // Закуп штуки — уже копейки, штуки — целые: округлять нечего.
    const kopecks = sign * unit * (line.count as number);
    const entry = bySku.get(sku) ?? { sku, count: 0, kopecks: 0, operationIds: [] };
    entry.count += sign * (line.count as number);
    entry.kopecks += kopecks;
    entry.operationIds.push(line.id);
    bySku.set(sku, entry);
    lineCogs.set(line.id, kopecks);
    total += kopecks;
  }

  return {
    cogs: { kopecks: total, bySku: [...bySku.values()], unknown: [...unknown.values()] },
    lineCogs,
    lineUnits,
    unknownCostLines,
  };
}

/**
 * Продажи без закупа на дату: различные заказы строк продажи (строка без
 * номера заказа — сама по себе) и их сумма. Возвраты не вычитаются: вопрос —
 * какая часть проданного посчитана без себестоимости.
 */
function unconfirmedOfLines(
  lines: readonly IPnlLine[],
  unknownCostLines: ReadonlySet<string>,
  cogs: IPnlCogs,
): IUnconfirmedProfit {
  const orders = new Set<string>();
  let revenueKopecks = 0;
  for (const line of lines) {
    if (line.goods !== 'sold' || !unknownCostLines.has(line.id)) continue;
    orders.add(line.orderId ? `order:${line.orderId}` : `line:${line.id}`);
    revenueKopecks += line.amountKopecks;
  }
  return unconfirmedOf(
    orders.size,
    revenueKopecks,
    cogs.unknown.map((entry) => entry.sku),
  );
}

/** Штуки: учтённые и без закупа — одна сумма, чтобы число не зависело от полноты прайса. */
function unitsOf(cogs: IPnlCogs): number {
  let units = 0;
  for (const entry of cogs.bySku) units += entry.count;
  for (const entry of cogs.unknown) units += entry.count;
  return units;
}

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/** P&L периода. */
export function pnlOf(input: IPnlInput): IPnl {
  const { period } = input;
  const byArticle = emptyBuckets();
  const accrued: IPnlLine[] = [];
  const orders = new Set<string>();

  for (const line of input.lines) {
    if (!inPeriod(line.accruedDay, period)) continue;
    accrued.push(line);
    if (line.article === 'sales' && line.orderId) orders.add(line.orderId);
    const bucket = byArticle[line.article];
    bucket.kopecks += line.amountKopecks;
    bucket.operationIds.push(line.id);
  }

  const { cogs, lineCogs, lineUnits, unknownCostLines } = cogsOf(accrued, input.costOf);
  const revenueKopecks = sectionSum(byArticle, 'revenue');
  const otherIncomeKopecks = sectionSum(byArticle, 'other_income');
  const marketplaceKopecks = sectionSum(byArticle, 'marketplace');
  const unrecognizedKopecks = sectionSum(byArticle, 'unrecognized');

  const grossKopecks = revenueKopecks + otherIncomeKopecks - cogs.kopecks;
  const afterMarketplaceKopecks = grossKopecks + marketplaceKopecks + unrecognizedKopecks;
  const operatingKopecks = afterMarketplaceKopecks - input.expenses.totalKopecks;

  // Вычеты «Доходы минус расходы»: себестоимость, услуги площадки и опер.
  // расходы. Нераспознанное не вычитается — как и не облагается.
  const deductible = Math.max(cogs.kopecks - marketplaceKopecks + input.expenses.totalKopecks, 0);
  const tax = taxOf(input.tax, taxLinesOf(input.lines), period, deductible);
  const netKopecks = operatingKopecks - tax.taxKopecks;

  return {
    period,
    byArticle,
    revenueKopecks,
    otherIncomeKopecks,
    cogs,
    ordersCount: orders.size,
    units: unitsOf(cogs),
    grossKopecks,
    marketplaceKopecks,
    unrecognizedKopecks,
    afterMarketplaceKopecks,
    operatingExpenses: input.expenses,
    operatingKopecks,
    tax,
    netKopecks,
    grossMargin: ratio(grossKopecks, revenueKopecks),
    netMargin: ratio(netKopecks, revenueKopecks),
    reference: byArticle.bonus_payment,
    unconfirmed: unconfirmedOfLines(accrued, unknownCostLines, cogs),
    skus: skuBreakdownOf({
      accrued,
      all: input.lines,
      lineCogs,
      unknownCostLines,
      taxKopecks: tax.taxKopecks,
      operatingKopecks: input.expenses.totalKopecks,
    }),
    salesByDay: salesByDayOf({
      accrued,
      lineUnits,
      isRevenue: (article) => PNL_SECTION[article] === 'revenue',
    }),
    skuSalesByDay: skuSalesByDayOf({ accrued, lineUnits }),
  };
}
