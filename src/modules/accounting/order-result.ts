/**
 * Результат заказа «Финучёта» (TASK-217, ТЗ п.4, п.7, п.14) — ядро нового движка.
 * Чистая функция: без Nest и базы; строки, операции и себестоимость собирает
 * вызывающий (API карточки — TASK-222).
 *
 * Вход: строки заказа (снимок `accounting_order_lines`), операции реестра заказа
 * (живые строки журнала с уже развёрнутой расшифровкой — как их отдаёт
 * `liveByOrderIds` — плюс ручные операции), себестоимость v2 единицы на момент
 * продажи и — необязательно — распределённые суммы по выбранной методике.
 *
 * Выход: карточка — у каждой суммы источник `actual | expected | allocated |
 * unknown` и список операций, чистая прибыль в целых копейках = Σ строк карточки.
 *
 * Правила:
 * - знак — как в журнале: «+» продавцу, «−» удержание; себестоимость — минус;
 * - выручка продавца = продажи + возвраты + субсидии площадки: скидка за счёт
 *   площадки не уменьшает выручку (приёмка №4), и субсидия входит в карточку
 *   ровно один раз — в выручку; компенсации — отдельной строкой, не в выручку;
 * - фактическая сумма не подменяется расчётной без метки: нет операций —
 *   `expected` (только из полей строки заказа, никогда не процентом) или `unknown`;
 * - распределённое — только переданное вызывающим по явной методике, всегда
 *   `allocated` с названием методики (решение `accounting_allocated_is_labeled`);
 * - неизвестная себестоимость → чистая прибыль `null` с причиной, не 0
 *   (`accounting_unknown_cost_strict`);
 * - `bonus_payment` — справочно (не деньги), вне суммы.
 *
 * Текущий механизм (`pnl.ts`, `order-feed.ts`) отсюда не зовётся и не меняется
 * (`accounting_beside_current`).
 */

import type { TAccountingUnitCost } from './accounting-cost-history.domain';
import type { IFifoSale, TLotSaleCost, TOrderCostMethod } from './accounting-lots.domain';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TAccountingSubArticle } from './accounting-sub-articles';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceArticle } from '../finance/finance-articles';
import type { IPnlOperation } from '../finance/pnl';

import { moscowDayStartOf } from './accounting-cost-history.domain';

/** Откуда сумма карточки. */
export type TOrderResultSource = 'actual' | 'expected' | 'allocated' | 'unknown';

/** Строка карточки заказа. */
export type TOrderResultKey =
  | 'revenue'
  | 'commission'
  | 'acquiring'
  | 'delivery'
  | 'reverse_logistics'
  | 'other_services'
  | 'advertising'
  | 'advertising_allocated'
  | 'opex_allocated'
  | 'other_expenses'
  | 'compensations'
  | 'cogs'
  | 'cogs_write_off'
  | 'tax_allocated';

/** Порядок — порядок ключей; подпись — для экрана. */
export const ORDER_RESULT_TITLE: Record<TOrderResultKey, string> = {
  revenue: 'Выручка продавца',
  commission: 'Комиссия',
  acquiring: 'Эквайринг',
  delivery: 'Логистика до покупателя',
  reverse_logistics: 'Обратная логистика',
  other_services: 'Прочие услуги',
  advertising: 'Реклама заказа',
  advertising_allocated: 'Реклама (распределено)',
  opex_allocated: 'Общие расходы (распределено)',
  other_expenses: 'Прочие расходы',
  compensations: 'Компенсации и корректировки',
  cogs: 'Себестоимость',
  cogs_write_off: 'Списание возврата',
  tax_allocated: 'Налог (распределено)',
};

const ORDER_RESULT_KEYS = Object.keys(ORDER_RESULT_TITLE) as TOrderResultKey[];

/**
 * Статья журнала → строка карточки. `reference` — справочное, вне суммы.
 * `Record` — новая статья без места в карточке не скомпилируется.
 */
export const ORDER_RESULT_KEY_OF_ARTICLE: Record<TFinanceArticle, TOrderResultKey | 'reference'> = {
  sales: 'revenue',
  returns: 'revenue',
  // Субсидия площадки — часть цены продавца, которую доплачивает площадка (ТЗ п.4).
  subsidies: 'revenue',
  compensations: 'compensations',
  other_income: 'compensations',
  commission: 'commission',
  acquiring: 'acquiring',
  delivery_to_buyer: 'delivery',
  reverse_logistics: 'reverse_logistics',
  promotion: 'advertising',
  storage: 'other_services',
  acceptance: 'other_services',
  processing: 'other_services',
  paid_options: 'other_services',
  penalties: 'other_services',
  withholdings: 'other_services',
  subscription: 'other_services',
  other_services: 'other_services',
  // Не распознано — видно в прочих услугах своей операцией, а не теряется.
  unknown: 'other_services',
  bonus_payment: 'reference',
  promotion_report: 'reference',
};

/**
 * Без которых прибыль заказа не считается: нет операций и нет расчётной суммы —
 * прибыль `null`. Остальные строки без операций — фактический 0: их отсутствие у
 * заказа — нормальный случай (возврата не было, штрафа не было).
 */
export const ORDER_RESULT_REQUIRED_KEYS: ReadonlySet<TOrderResultKey> = new Set([
  'revenue',
  'commission',
  'delivery',
  'cogs',
  // Есть только у повреждённого/утраченного возврата в режиме Б.
  'cogs_write_off',
]);

/** Операция заказа: строка журнала или ручная операция, приведённая к той же форме. */
export interface IOrderResultOperation extends IPnlOperation {
  subArticle?: TAccountingSubArticle | null;
  origin: 'journal' | 'manual';
}

/** Себестоимость единицы: v2 на момент или «товар не найден по артикулу». */
export type TOrderUnitCost = TAccountingUnitCost | { status: 'unknown'; reason: 'no-product' };

export type TOrderCostOf = (line: IAccountingOrderLineInput, moment: Date) => TOrderUnitCost;

/** Режим Б: себестоимость позиции по партиям FIFO (`fifoAllocate`). */
export type TOrderLotCostOf = (line: IAccountingOrderLineInput) => TLotSaleCost;

/** Пометка у себестоимости: возврат без состояния принят пригодным (`accounting_lots_return_condition`). */
export const RETURN_ASSUMED_FIT_NOTE = 'Состояние возврата неизвестно, принято пригодным';

/** Доля одного расхода продавца на заказ (TASK-220): копейки со знаком, расход — минус. */
export interface IOrderExpenseShare {
  id: string;
  /** Категория расхода — подпись строки раскрытия. */
  title: string;
  kopecks: number;
  method: string;
}

/** Сумма, распределённая на заказ по методике (TASK-219/221). */
export interface IOrderAllocated {
  kopecks: number;
  /** Название методики — показывается рядом с суммой. */
  method: string;
  /** Только у «Прочих расходов» — из каких расходов продавца сложилась сумма. */
  expenses?: IOrderExpenseShare[];
}

export interface IOrderAllocations {
  advertising?: IOrderAllocated;
  /** Общие операционные расходы магазина (хранение, подписка, ручные без заказа). */
  opex?: IOrderAllocated;
  tax?: IOrderAllocated;
  /** Расходы продавца, привязанные к заказу или товару (TASK-220). */
  other?: IOrderAllocated;
}

export type TOrderResultReason =
  | 'no-operations'
  | 'no-line-value'
  | 'no-record'
  | 'unconvertible'
  | 'no-product'
  | 'no-sale-moment'
  | 'no-lot'
  | 'no-lines';

export interface IOrderResultAmount {
  key: TOrderResultKey;
  title: string;
  /** Копейки со знаком; null — неизвестно. */
  kopecks: number | null;
  source: TOrderResultSource;
  operationIds: string[];
  /** Методика — только у `allocated`. */
  method?: string;
  /** Почему `expected` или `unknown`. */
  reason?: TOrderResultReason;
  /** Пометка к сумме для экрана: у налога на заказ — `ORDER_TAX_ESTIMATE_NOTE`. */
  note?: string;
  /** Только у «Прочих расходов» — расходы продавца по отдельности. */
  expenses?: IOrderExpenseShare[];
}

/**
 * Налог на заказ — доля налога периода по методике, оценка (ТЗ п.6, TASK-221,
 * `accounting_allocated_is_labeled`): обязательство возникает у периода, не у заказа.
 */
export const ORDER_TAX_ESTIMATE_NOTE = 'Оценка, не обязательство';

/** Цены сделки по всем строкам (× кол-во); null — у какой-то строки неизвестно. */
export interface IOrderResultPrices {
  buyerKopecks: number | null;
  sellerKopecks: number | null;
  recognizedKopecks: number | null;
  marketplaceDiscountKopecks: number | null;
}

export interface IOrderResultNet {
  kopecks: number | null;
  source: TOrderResultSource;
  /** Какая обязательная строка неизвестна и почему. */
  unknown: { key: TOrderResultKey; reason: TOrderResultReason | null } | null;
}

export interface IOrderResult {
  marketplace: TFinanceMarketplace;
  orderId: string;
  prices: IOrderResultPrices;
  amounts: IOrderResultAmount[];
  /** Справочные операции (оплачено баллами) — вне суммы. */
  referenceOperationIds: string[];
  net: IOrderResultNet;
  /** Σ известных строк по источнику — для разделения факта и ожидаемого (TASK-218). */
  bySource: Record<TOrderResultSource, number>;
  /** Как определена себестоимость: прайс (А), партии (Б) или не определена. */
  costMethod: TOrderCostMethod;
}

export interface IOrderResultInput {
  marketplace: TFinanceMarketplace;
  orderId: string;
  lines: readonly IAccountingOrderLineInput[];
  operations: readonly IOrderResultOperation[];
  costOf: TOrderCostOf;
  /** Есть — режим Б (партии FIFO), `costOf` не зовётся; нет — режим А. */
  lotCostOf?: TOrderLotCostOf;
  allocations?: IOrderAllocations;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Момент продажи для себестоимости v2: конец московского дня оформления
 * (нет — дня выкупа). У строк заказа есть только день, а прайс за день мог
 * загружаться несколько раз; конец дня берёт последний закуп, известный в день
 * сделки, — продажа днём оформления не остаётся без закупа из-за того, что
 * прайс загрузили позже утром (решение `accounting_order_result_sale_moment`).
 */
export function saleMomentOf(
  line: Pick<IAccountingOrderLineInput, 'createdOn' | 'soldOn'>,
): Date | null {
  const day = line.createdOn ?? line.soldOn;
  const start = day ? moscowDayStartOf(day) : null;
  return start ? new Date(start.getTime() + DAY_MS - 1) : null;
}

/** Строка вернулась: есть день возврата или статус `returned`. */
export function isReturnedOrderLine(line: IAccountingOrderLineInput): boolean {
  return Boolean(line.returnedOn) || (line.status ?? '').toLowerCase() === 'returned';
}

/** Строка отменена до продажи — товар со склада не уходил. */
export function isCancelledOrderLine(line: IAccountingOrderLineInput): boolean {
  return !isReturnedOrderLine(line) && (line.status ?? '').toLowerCase().startsWith('cancel');
}

/** Строка не продаёт товар: вернулась или отменена. */
export function isGoneOrderLine(line: IAccountingOrderLineInput): boolean {
  return isReturnedOrderLine(line) || isCancelledOrderLine(line);
}

/** Ключ позиции для FIFO: номер заказа уникален только внутри площадки. */
export const orderLineKeyOf = (
  line: Pick<IAccountingOrderLineInput, 'marketplace' | 'orderId' | 'itemId'>,
): string => `${line.marketplace}|${line.orderId}|${line.itemId}`;

/**
 * Позиция заказа → продажа FIFO; отменённая — null (не списывает). Возврат —
 * концом московского дня возврата, без дня — моментом продажи; состояние — из
 * строки (ЯМ, TASK-238), нет его — `unknown` (решение `accounting_lots_return_condition`).
 */
export function fifoSaleOf(
  line: IAccountingOrderLineInput,
  productId: string | null,
): IFifoSale | null {
  if (isCancelledOrderLine(line)) return null;
  const moment = saleMomentOf(line);
  let returned: IFifoSale['returned'] = null;
  if (isReturnedOrderLine(line)) {
    const start = line.returnedOn ? moscowDayStartOf(line.returnedOn) : null;
    const at = start ? new Date(start.getTime() + DAY_MS - 1) : moment;
    // Нет ни дня возврата, ни момента продажи — продажа и так не спишется.
    if (at) returned = { moment: at, condition: line.returnCondition ?? 'unknown' };
  }
  return { key: orderLineKeyOf(line), productId, count: line.count, moment, returned };
}

function sumOrNull(values: readonly (number | null | undefined)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined) return null;
    total += value;
  }
  return total;
}

function perLine(
  lines: readonly IAccountingOrderLineInput[],
  unit: (line: IAccountingOrderLineInput) => number | null | undefined,
): number | null {
  if (!lines.length) return null;
  return sumOrNull(
    lines.map((line) => {
      const value = unit(line);
      return value === null || value === undefined ? null : value * line.count;
    }),
  );
}

function pricesOf(lines: readonly IAccountingOrderLineInput[]): IOrderResultPrices {
  return {
    buyerKopecks: perLine(lines, (l) => l.buyerPriceKopecks),
    sellerKopecks: perLine(lines, (l) => l.priceKopecks),
    recognizedKopecks: lines.length ? sumOrNull(lines.map((l) => l.revenueKopecks)) : null,
    marketplaceDiscountKopecks: perLine(lines, (l) => l.marketplaceSubsidyKopecks),
  };
}

function actual(key: TOrderResultKey, kopecks: number, ids: string[]): IOrderResultAmount {
  return { key, title: ORDER_RESULT_TITLE[key], kopecks, source: 'actual', operationIds: ids };
}

function expected(key: TOrderResultKey, kopecks: number): IOrderResultAmount {
  return {
    key,
    title: ORDER_RESULT_TITLE[key],
    kopecks,
    source: 'expected',
    operationIds: [],
    reason: 'no-operations',
  };
}

function unknown(key: TOrderResultKey, reason: TOrderResultReason): IOrderResultAmount {
  return {
    key,
    title: ORDER_RESULT_TITLE[key],
    kopecks: null,
    source: 'unknown',
    operationIds: [],
    reason,
  };
}

/** Расчётная выручка из строк заказа: живые строки, цена сделки. */
function expectedRevenue(lines: readonly IAccountingOrderLineInput[]): IOrderResultAmount {
  if (!lines.length) return unknown('revenue', 'no-lines');
  const total = sumOrNull(lines.filter((l) => !isGoneOrderLine(l)).map((l) => l.revenueKopecks));
  return total === null ? unknown('revenue', 'no-line-value') : expected('revenue', total);
}

/** Расчётная комиссия — только поле площадки в заказе (Ozon), никогда не процент. */
function expectedCommission(lines: readonly IAccountingOrderLineInput[]): IOrderResultAmount {
  const live = lines.filter((l) => !isGoneOrderLine(l));
  const total = live.length ? perLine(live, (l) => l.commissionKopecks) : null;
  return total === null ? unknown('commission', 'no-operations') : expected('commission', -total);
}

function cogsOfLines(
  lines: readonly IAccountingOrderLineInput[],
  costOf: TOrderCostOf,
): IOrderResultAmount {
  if (!lines.length) return unknown('cogs', 'no-lines');
  let total = 0;
  for (const line of lines) {
    if (isGoneOrderLine(line)) continue;
    const moment = saleMomentOf(line);
    if (!moment) return unknown('cogs', 'no-sale-moment');
    const unit = costOf(line, moment);
    if (unit.status === 'unknown') return unknown('cogs', unit.reason);
    // Закуп единицы — уже целые копейки, штуки — целые: округлять нечего.
    total -= unit.kopecks * line.count;
  }
  return actual('cogs', total, []);
}

/** Режим Б: себестоимость живых позиций по партиям; возвраты сюда не входят. */
function cogsOfLotLines(
  lines: readonly IAccountingOrderLineInput[],
  lotCostOf: TOrderLotCostOf,
): IOrderResultAmount {
  if (!lines.length) return unknown('cogs', 'no-lines');
  let total = 0;
  let assumedFit = false;
  for (const line of lines) {
    if (isCancelledOrderLine(line)) continue;
    const cost = lotCostOf(line);
    if (isReturnedOrderLine(line)) {
      if (cost.returned?.restored && cost.returned.condition === 'unknown') assumedFit = true;
      continue;
    }
    if (cost.status === 'unknown') return unknown('cogs', cost.reason);
    total -= cost.kopecks;
  }
  const amount = actual('cogs', total, []);
  return assumedFit ? { ...amount, note: RETURN_ASSUMED_FIT_NOTE } : amount;
}

/**
 * Режим Б: повреждённый/утраченный возврат — штуки в партию не вернулись,
 * их себестоимость — строкой списания. Таких возвратов нет — строки нет.
 * Общая с результатом возвращённого заказа (`return-result.ts`).
 */
export function writeOffOfLotLines(
  lines: readonly IAccountingOrderLineInput[],
  lotCostOf: TOrderLotCostOf,
): IOrderResultAmount | null {
  let total = 0;
  let any = false;
  for (const line of lines) {
    if (!isReturnedOrderLine(line)) continue;
    const cost = lotCostOf(line);
    if (!cost.returned || cost.returned.restored) continue;
    any = true;
    if (cost.status === 'unknown') return unknown('cogs_write_off', cost.reason);
    total -= cost.kopecks;
  }
  return any ? actual('cogs_write_off', total, []) : null;
}

function allocated(key: TOrderResultKey, value: IOrderAllocated): IOrderResultAmount {
  const amount: IOrderResultAmount = {
    key,
    title: ORDER_RESULT_TITLE[key],
    kopecks: value.kopecks,
    source: 'allocated',
    operationIds: [],
    method: value.method,
  };
  if (value.expenses) amount.expenses = value.expenses;
  return amount;
}

/** Карточка результата одного заказа. */
export function orderResultOf(input: IOrderResultInput): IOrderResult {
  const { lines, operations, allocations } = input;

  const byKey = new Map<TOrderResultKey, { kopecks: number; ids: string[] }>();
  const referenceOperationIds: string[] = [];
  for (const op of operations) {
    const key = ORDER_RESULT_KEY_OF_ARTICLE[op.article];
    if (key === 'reference') {
      if (!referenceOperationIds.includes(op.id)) referenceOperationIds.push(op.id);
      continue;
    }
    const entry = byKey.get(key) ?? { kopecks: 0, ids: [] };
    entry.kopecks += op.amountKopecks;
    // Части одной сводной операции несут её id — в списке он один раз.
    if (!entry.ids.includes(op.id)) entry.ids.push(op.id);
    byKey.set(key, entry);
  }

  const amounts: IOrderResultAmount[] = [];
  for (const key of ORDER_RESULT_KEYS) {
    const found = byKey.get(key);
    if (key === 'cogs') {
      amounts.push(
        input.lotCostOf ? cogsOfLotLines(lines, input.lotCostOf) : cogsOfLines(lines, input.costOf),
      );
    } else if (key === 'cogs_write_off') {
      const writeOff = input.lotCostOf ? writeOffOfLotLines(lines, input.lotCostOf) : null;
      if (writeOff) amounts.push(writeOff);
    } else if (key === 'advertising_allocated') {
      if (allocations?.advertising) amounts.push(allocated(key, allocations.advertising));
    } else if (key === 'opex_allocated') {
      if (allocations?.opex) amounts.push(allocated(key, allocations.opex));
    } else if (key === 'other_expenses') {
      if (allocations?.other) amounts.push(allocated(key, allocations.other));
    } else if (key === 'tax_allocated') {
      if (allocations?.tax) {
        amounts.push({ ...allocated(key, allocations.tax), note: ORDER_TAX_ESTIMATE_NOTE });
      }
    } else if (found) {
      amounts.push(actual(key, found.kopecks, found.ids));
    } else if (key === 'revenue') {
      amounts.push(expectedRevenue(lines));
    } else if (key === 'commission') {
      amounts.push(expectedCommission(lines));
    } else if (key === 'delivery') {
      amounts.push(unknown(key, 'no-operations'));
    } else {
      amounts.push(actual(key, 0, []));
    }
  }

  const bySource: Record<TOrderResultSource, number> = {
    actual: 0,
    expected: 0,
    allocated: 0,
    unknown: 0,
  };
  for (const amount of amounts) {
    if (amount.kopecks !== null) bySource[amount.source] += amount.kopecks;
  }

  const missing = amounts.find((a) => a.kopecks === null && ORDER_RESULT_REQUIRED_KEYS.has(a.key));
  let net: IOrderResultNet;
  if (missing) {
    net = {
      kopecks: null,
      source: 'unknown',
      unknown: { key: missing.key, reason: missing.reason ?? null },
    };
  } else {
    const sources = new Set(amounts.map((a) => a.source));
    let source: TOrderResultSource = 'actual';
    if (sources.has('expected')) source = 'expected';
    else if (sources.has('allocated')) source = 'allocated';
    net = {
      kopecks: amounts.reduce((sum, a) => sum + (a.kopecks ?? 0), 0),
      source,
      unknown: null,
    };
  }

  const cogsKnown = amounts.every(
    (a) => (a.key !== 'cogs' && a.key !== 'cogs_write_off') || a.kopecks !== null,
  );
  let costMethod: TOrderCostMethod = 'unknown';
  if (cogsKnown) costMethod = input.lotCostOf ? 'lot_fifo' : 'historical_price';

  return {
    marketplace: input.marketplace,
    orderId: input.orderId,
    prices: pricesOf(lines),
    amounts,
    referenceOperationIds,
    net,
    bySource,
    costMethod,
  };
}
