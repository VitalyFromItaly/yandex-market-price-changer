/**
 * Карточка и список заказов «Финучёта» (TASK-222, ТЗ п.4–п.7) — чистая часть:
 * вход для `orderResultOf` / `allocateStoreCosts` из строк базы и раскрытие
 * каждой суммы карточки до операций. Без Nest и базы — собирает
 * `AccountingOrderCardService`.
 *
 * Правила (решения `accounting_order_card_*`):
 * - распределение — по календарному московскому месяцу оформления заказа: сумма
 *   заказа одна и та же в карточке и в списке, от фильтра не зависит;
 * - база распределения — заказы месяца всего аккаунта (журнал бизнесовый),
 *   веса — по строкам заказа (выручка / штуки живых позиций); магазин из URL
 *   только сужает выдачу ЯМ;
 * - раскрытие суммы = её части журнала/ручных: Σ частей = сумма строки по
 *   построению (те же операции, что сложил `orderResultOf`).
 */

import type { TAccountingUnitCost } from './accounting-cost-history.domain';
import type {
  ILotPortion,
  TAccountingCostMethod,
  TOrderCostMethod,
} from './accounting-lots.domain';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TOrderReconcileState } from './accounting-reconcile.domain';
import type {
  IOrderProfit,
  TOrderProfitReason,
  TOrderProfitState,
  TOrderResultSnapshotReason,
} from './order-profit-state';
import type {
  IOrderAllocated,
  IOrderAllocations,
  IOrderExpenseShare,
  IOrderResultOperation,
  IOrderResultPrices,
  TOrderLotCostOf,
  TOrderResultKey,
  TOrderResultSource,
  TOrderUnitCost,
} from './order-result';
import type { IAllocationOrder, IStoreCostItem } from './store-cost-allocation';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IPnlOperation } from '../finance/pnl';

import { FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { financeToday } from '../finance/finance-period';

import { ACCOUNTING_COST_METHOD_TITLE } from './accounting-lots.domain';
import { ORDER_PROFIT_STATE_HINT, ORDER_PROFIT_STATE_TITLE } from './order-profit-state';
import { isGoneOrderLine, saleMomentOf } from './order-result';
import { storeCostKindOf } from './store-cost-allocation';

/** Ключ заказа: номер уникален только внутри площадки. */
export function orderKeyOf(marketplace: TFinanceMarketplace, orderId: string): string {
  return `${marketplace}|${orderId}`;
}

/** Ручная операция в той форме, что нужна карточке. */
export interface IOrderCardManualRow {
  id: string;
  marketplace: TFinanceMarketplace;
  article: IPnlOperation['article'];
  subArticle?: string | null;
  amountKopecks: number;
  accruedOn: string;
  orderId: string | null;
  sku: string | null;
  documentNumber: string | null;
  note: string | null;
}

/** Операция заказа + то, чего нет в `IPnlOperation`: номер документа и площадка. */
export interface IOrderCardOperation extends IOrderResultOperation {
  marketplace: TFinanceMarketplace;
  /** Журнал — `last_document_id` (версия отчёта); ручная — номер документа из формы. */
  documentId: string | null;
}

const moscowDayStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

/** Строка журнала заказа → операция карточки. */
export function journalOperationOf(
  op: IPnlOperation,
  marketplace: TFinanceMarketplace,
  documentId: string | null,
): IOrderCardOperation {
  return {
    ...op,
    subArticle: (op.subArticle ?? null) as IOrderResultOperation['subArticle'],
    origin: 'journal',
    marketplace,
    documentId,
  };
}

/** Ручная операция → операция карточки (день начисления — начало московского дня). */
export function manualOperationOf(row: IOrderCardManualRow): IOrderCardOperation {
  return {
    id: row.id,
    article: row.article,
    amountKopecks: row.amountKopecks,
    orderId: row.orderId,
    sku: row.sku,
    serviceName: row.note,
    transactionType: 'manual',
    transactionSource: null,
    accruedAt: moscowDayStart(row.accruedOn),
    paidAt: null,
    actDate: null,
    count: null,
    marketplace: row.marketplace,
    subArticle: (row.subArticle ?? null) as IOrderResultOperation['subArticle'],
    origin: 'manual',
    documentId: row.documentNumber,
  };
}

/** Строки месяца по заказам: ключ `orderKeyOf`. */
export function groupLinesByOrder(
  lines: readonly IAccountingOrderLineInput[],
): Map<string, IAccountingOrderLineInput[]> {
  const result = new Map<string, IAccountingOrderLineInput[]>();
  for (const line of lines) {
    const key = orderKeyOf(line.marketplace, line.orderId);
    const list = result.get(key) ?? [];
    list.push(line);
    result.set(key, list);
  }
  return result;
}

/**
 * База распределения заказа: выручка и штуки живых позиций из строк заказа.
 * Неизвестная выручка у позиции — заказ в базу «по выручке» не входит (null).
 */
export function allocationOrderOf(
  key: string,
  lines: readonly IAccountingOrderLineInput[],
): IAllocationOrder {
  const live = lines.filter((line) => !isGoneOrderLine(line));
  let revenue: number | null = 0;
  let units = 0;
  for (const line of live) {
    if (line.revenueKopecks === null) revenue = null;
    else if (revenue !== null) revenue += line.revenueKopecks;
    units += line.count;
  }
  return { orderId: key, revenueKopecks: live.length ? revenue : null, units };
}

/** Операция без заказа → общий расход магазина (доход — `kind: null`, в нераспределённое). */
export function storeCostItemOf(op: IOrderCardOperation): IStoreCostItem {
  return {
    id: op.id,
    kind: storeCostKindOf(op.article),
    kopecks: op.amountKopecks,
    title: op.serviceName ?? FINANCE_ARTICLE_META[op.article].title,
    article: op.article,
    accruedOn: financeToday(op.accruedAt),
    source: op.origin,
  };
}

/**
 * Слияние распределённого из нескольких вызовов `allocateStoreCosts`. Один вид из
 * двух вызовов (общие расходы площадки и всего бизнеса, TASK-220) складывается:
 * методика у них одна, расшифровки расходов склеиваются.
 */
export function mergeAllocations(
  parts: readonly Map<string, IOrderAllocations>[],
): Map<string, IOrderAllocations> {
  const result = new Map<string, IOrderAllocations>();
  for (const part of parts) {
    for (const [key, value] of part) {
      const merged: IOrderAllocations = { ...result.get(key) };
      for (const kind of Object.keys(value) as (keyof IOrderAllocations)[]) {
        const next = value[kind];
        const prev = merged[kind];
        if (!next) continue;
        merged[kind] = prev ? sumAllocated(prev, next) : next;
      }
      result.set(key, merged);
    }
  }
  return result;
}

function sumAllocated(a: IOrderAllocated, b: IOrderAllocated): IOrderAllocated {
  const methods = [...new Set([...a.method.split(', '), ...b.method.split(', ')])];
  const sum: IOrderAllocated = { kopecks: a.kopecks + b.kopecks, method: methods.join(', ') };
  if (a.expenses || b.expenses) sum.expenses = [...(a.expenses ?? []), ...(b.expenses ?? [])];
  return sum;
}

/** Месяц (московский) дня оформления заказа: первая позиция с днём. */
export function orderMonthOf(lines: readonly IAccountingOrderLineInput[]): IFinancePeriod | null {
  const day = lines.map((l) => l.createdOn ?? l.soldOn).find((d): d is string => Boolean(d));
  if (!day) return null;
  const [year, month] = day.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

// ── Раскрытие ──────────────────────────────────────────────────────────────

export interface IOrderCardOperationView {
  id: string;
  title: string;
  /** Часть операции, попавшая в эту строку карточки (сводная строка — по статье). */
  kopecks: number;
  /** День начисления, ГГГГ-ММ-ДД (Москва). */
  accruedOn: string;
  marketplace: TFinanceMarketplace;
  documentId: string | null;
  origin: 'journal' | 'manual';
}

export interface IOrderCardCostLine {
  itemId: string;
  offerId: string | null;
  offerName: string | null;
  count: number;
  /** Закуп единицы, копейки; null — неизвестен. */
  unitKopecks: number | null;
  /** С какого момента действует запись закупа v2. */
  recordFrom: Date | null;
  /** Себестоимость позиции целиком, копейки «+»; null — неизвестна. */
  totalKopecks: number | null;
  /** Режим Б — из каких партий взяты штуки (день поступления, штуки, сумма). */
  portions?: Omit<ILotPortion, 'lotId'>[];
  reason: string | null;
}

export interface IOrderCardAmount {
  key: TOrderResultKey;
  title: string;
  kopecks: number | null;
  source: TOrderResultSource;
  reason: TOrderProfitReason | null;
  /** Методика у распределённого. */
  method: string | null;
  /** Основание прогноза. */
  basis: string | null;
  note: string | null;
  operations: IOrderCardOperationView[];
  /** Только у себестоимости — по позициям. */
  costLines?: IOrderCardCostLine[];
  /** Только у распределённого — месяц, общие расходы которого распределены. */
  allocationPeriod?: IFinancePeriod;
  /** Только у «Прочих расходов» — расходы продавца по отдельности (TASK-220). */
  expenses?: IOrderExpenseShare[];
}

export interface IOrderCardLine {
  itemId: string;
  offerId: string | null;
  offerName: string | null;
  count: number;
  priceKopecks: number | null;
  buyerPriceKopecks: number | null;
  marketplaceSubsidyKopecks: number | null;
  revenueKopecks: number | null;
  status: string | null;
  createdOn: string | null;
  soldOn: string | null;
  returnedOn: string | null;
}

export interface IOrderCardSnapshotVersion {
  version: number;
  state: TOrderProfitState;
  reason: TOrderResultSnapshotReason;
  netKopecks: number | null;
  capturedAt: Date;
}

export interface IAccountingOrderCard {
  marketplace: TFinanceMarketplace;
  orderId: string;
  createdOn: string | null;
  state: TOrderProfitState;
  stateTitle: string;
  stateHint: string;
  final: boolean;
  reconcile: TOrderReconcileState | null;
  /** Методика распределения общих расходов (одна на все виды). */
  costMethod: string;
  /** Как определена себестоимость заказа (TASK-215): прайс, партии или не определена. */
  cogsMethod: TOrderCostMethod;
  cogsMethodTitle: string;
  allocationPeriod: IFinancePeriod;
  prices: IOrderResultPrices;
  amounts: IOrderCardAmount[];
  /** Справочное (оплачено баллами) — вне суммы. */
  reference: IOrderCardOperationView[];
  confirmedKopecks: number;
  expectedKopecks: number;
  netKopecks: number | null;
  unknown: { key: TOrderResultKey; reason: TOrderProfitReason | null } | null;
  lines: IOrderCardLine[];
  snapshot: { version: number; written: boolean; reason: TOrderResultSnapshotReason | null };
  versions: IOrderCardSnapshotVersion[];
}

/** Части операций по строке карточки — та же раскладка статьи, что у `orderResultOf`. */
export function operationViewsOf(
  ids: readonly string[],
  operations: readonly IOrderCardOperation[],
  keyOf: (op: IOrderCardOperation) => string,
  key: string,
): IOrderCardOperationView[] {
  const wanted = new Set(ids);
  return operations
    .filter((op) => wanted.has(op.id) && keyOf(op) === key)
    .map((op) => ({
      id: op.id,
      title: op.serviceName ?? FINANCE_ARTICLE_META[op.article].title,
      kopecks: op.amountKopecks,
      accruedOn: financeToday(op.accruedAt),
      marketplace: op.marketplace,
      documentId: op.documentId,
      origin: op.origin,
    }));
}

/** Себестоимость по позициям: закуп v2 на момент продажи или причина. */
export function costLinesOf(
  lines: readonly IAccountingOrderLineInput[],
  costOf: (line: IAccountingOrderLineInput, moment: Date) => TOrderUnitCost,
): IOrderCardCostLine[] {
  return lines
    .filter((line) => !isGoneOrderLine(line))
    .map((line) => {
      const moment = saleMomentOf(line);
      const unit: TOrderUnitCost | null = moment ? costOf(line, moment) : null;
      const known =
        unit?.status === 'known'
          ? (unit as Extract<TAccountingUnitCost, { status: 'known' }>)
          : null;
      let reason: string | null = null;
      if (unit === null) reason = 'no-sale-moment';
      else if (unit.status === 'unknown') reason = unit.reason;
      return {
        itemId: line.itemId,
        offerId: line.offerId,
        offerName: line.offerName,
        count: line.count,
        unitKopecks: known ? known.kopecks : null,
        recordFrom: known ? known.record.validFrom : null,
        totalKopecks: known ? known.kopecks * line.count : null,
        reason,
      };
    });
}

/**
 * Режим Б: себестоимость по позициям из партий FIFO. Цена штуки — только если
 * все штуки стоят одинаково (одна партия без дробления доп. расходов).
 */
export function lotCostLinesOf(
  lines: readonly IAccountingOrderLineInput[],
  lotCostOf: TOrderLotCostOf,
): IOrderCardCostLine[] {
  return lines
    .filter((line) => !isGoneOrderLine(line))
    .map((line) => {
      const cost = lotCostOf(line);
      const base = {
        itemId: line.itemId,
        offerId: line.offerId,
        offerName: line.offerName,
        count: line.count,
        recordFrom: null,
      };
      if (cost.status === 'unknown') {
        return { ...base, unitKopecks: null, totalKopecks: null, reason: cost.reason };
      }
      const unit = cost.kopecks / line.count;
      return {
        ...base,
        unitKopecks: Number.isInteger(unit) ? unit : null,
        totalKopecks: cost.kopecks,
        portions: cost.portions.map(({ receivedDay, units, kopecks }) => ({
          receivedDay,
          units,
          kopecks,
        })),
        reason: null,
      };
    });
}

export interface IOrderCardInput {
  marketplace: TFinanceMarketplace;
  orderId: string;
  profit: IOrderProfit;
  referenceIds: readonly string[];
  lines: readonly IAccountingOrderLineInput[];
  operations: readonly IOrderCardOperation[];
  /** Статья → строка карточки (`ORDER_RESULT_KEY_OF_ARTICLE`). */
  keyOfArticle: (op: IOrderCardOperation) => string;
  costOf: (line: IAccountingOrderLineInput, moment: Date) => TOrderUnitCost;
  /** Режим Б — себестоимость по партиям (как в `orderResultOf`). */
  lotCostOf?: TOrderLotCostOf;
  /** `IOrderResult.costMethod` заказа. */
  cogsMethod: TOrderCostMethod;
  prices: IOrderResultPrices;
  costMethod: string;
  allocationPeriod: IFinancePeriod;
  snapshot: IAccountingOrderCard['snapshot'];
  versions: IOrderCardSnapshotVersion[];
}

/** Подпись способа себестоимости для экрана. */
export const cogsMethodTitleOf = (method: TOrderCostMethod): string =>
  method === 'unknown' ? 'Не определена' : ACCOUNTING_COST_METHOD_TITLE[method];

/** Карточка заказа с раскрытием каждой суммы. */
export function orderCardOf(input: IOrderCardInput): IAccountingOrderCard {
  const { profit, operations, keyOfArticle } = input;
  const amounts: IOrderCardAmount[] = profit.amounts.map((amount) => {
    const view: IOrderCardAmount = {
      key: amount.key,
      title: amount.title,
      kopecks: amount.kopecks,
      source: amount.source,
      reason: amount.reason ?? null,
      method: amount.method ?? null,
      basis: amount.basis ?? null,
      note: amount.note ?? null,
      operations: operationViewsOf(amount.operationIds, operations, keyOfArticle, amount.key),
    };
    if (amount.key === 'cogs') {
      view.costLines = input.lotCostOf
        ? lotCostLinesOf(input.lines, input.lotCostOf)
        : costLinesOf(input.lines, input.costOf);
    }
    if (amount.source === 'allocated') view.allocationPeriod = input.allocationPeriod;
    if (amount.expenses) view.expenses = amount.expenses;
    return view;
  });
  const createdOn =
    input.lines.map((l) => l.createdOn).find((d): d is string => Boolean(d)) ?? null;
  return {
    marketplace: input.marketplace,
    orderId: input.orderId,
    createdOn,
    state: profit.state,
    stateTitle: ORDER_PROFIT_STATE_TITLE[profit.state],
    stateHint: ORDER_PROFIT_STATE_HINT[profit.state],
    final: profit.final,
    reconcile: profit.reconcile,
    costMethod: input.costMethod,
    cogsMethod: input.cogsMethod,
    cogsMethodTitle: cogsMethodTitleOf(input.cogsMethod),
    allocationPeriod: input.allocationPeriod,
    prices: input.prices,
    amounts,
    reference: operationViewsOf(input.referenceIds, operations, keyOfArticle, 'reference'),
    confirmedKopecks: profit.confirmedKopecks,
    expectedKopecks: profit.expectedKopecks,
    netKopecks: profit.netKopecks,
    unknown: profit.unknown,
    // Магазин ЯМ (campaignId) продавцу не показывается — в позиции не входит.
    lines: input.lines.map((line) => ({
      itemId: line.itemId,
      offerId: line.offerId,
      offerName: line.offerName,
      count: line.count,
      priceKopecks: line.priceKopecks,
      buyerPriceKopecks: line.buyerPriceKopecks,
      marketplaceSubsidyKopecks: line.marketplaceSubsidyKopecks,
      revenueKopecks: line.revenueKopecks,
      status: line.status,
      createdOn: line.createdOn,
      soldOn: line.soldOn,
      returnedOn: line.returnedOn,
    })),
    snapshot: input.snapshot,
    versions: input.versions,
  };
}

// ── Список ─────────────────────────────────────────────────────────────────

export interface IAccountingOrdersRow {
  marketplace: TFinanceMarketplace;
  orderId: string;
  createdOn: string | null;
  offerNames: string[];
  units: number;
  /** Выручка продавца из карточки; null — неизвестна. */
  revenueKopecks: number | null;
  confirmedKopecks: number;
  expectedKopecks: number;
  netKopecks: number | null;
  state: TOrderProfitState;
  stateTitle: string;
  isLoss: boolean;
}

export interface IAccountingOrdersFilter {
  marketplace?: TFinanceMarketplace | null;
  state?: TOrderProfitState | null;
  lossOnly?: boolean;
}

export interface IAccountingOrdersList {
  period: IFinancePeriod;
  costMethod: string;
  /** Режим себестоимости продавца, действующий для списка (TASK-215). */
  cogsMethod: TAccountingCostMethod;
  marketplaces: TFinanceMarketplace[];
  rows: IAccountingOrdersRow[];
  totals: {
    count: number;
    lossCount: number;
    confirmedKopecks: number;
    expectedKopecks: number;
    /** Σ известной прибыли строк; заказы с неизвестной — в `unknownCount`. */
    netKopecks: number;
    unknownCount: number;
  };
  /** Общие расходы месяца, которые не легли на заказы (методика «не распределять», нет базы). */
  unallocatedKopecks: number;
}

/** Строка списка из карточки. Убыточный — известная прибыль < 0; неизвестная — не убыток. */
export function ordersRowOf(input: {
  marketplace: TFinanceMarketplace;
  orderId: string;
  lines: readonly IAccountingOrderLineInput[];
  profit: IOrderProfit;
}): IAccountingOrdersRow {
  const { profit, lines } = input;
  const revenue = profit.amounts.find((a) => a.key === 'revenue');
  const live = lines.filter((line) => !isGoneOrderLine(line));
  return {
    marketplace: input.marketplace,
    orderId: input.orderId,
    createdOn: lines.map((l) => l.createdOn).find((d): d is string => Boolean(d)) ?? null,
    offerNames: [...new Set(lines.map((l) => l.offerName ?? l.offerId).filter(Boolean))],
    units: live.reduce((sum, line) => sum + line.count, 0),
    revenueKopecks: revenue?.kopecks ?? null,
    confirmedKopecks: profit.confirmedKopecks,
    expectedKopecks: profit.expectedKopecks,
    netKopecks: profit.netKopecks,
    state: profit.state,
    stateTitle: ORDER_PROFIT_STATE_TITLE[profit.state],
    isLoss: profit.netKopecks !== null && profit.netKopecks < 0,
  };
}

export function filterOrdersRows(
  rows: readonly IAccountingOrdersRow[],
  filter: IAccountingOrdersFilter,
): IAccountingOrdersRow[] {
  return rows
    .filter((row) => !filter.marketplace || row.marketplace === filter.marketplace)
    .filter((row) => !filter.state || row.state === filter.state)
    .filter((row) => !filter.lossOnly || row.isLoss)
    .sort(
      (a, b) =>
        (b.createdOn ?? '').localeCompare(a.createdOn ?? '') || b.orderId.localeCompare(a.orderId),
    );
}

export function ordersTotalsOf(
  rows: readonly IAccountingOrdersRow[],
): IAccountingOrdersList['totals'] {
  const totals = {
    count: rows.length,
    lossCount: 0,
    confirmedKopecks: 0,
    expectedKopecks: 0,
    netKopecks: 0,
    unknownCount: 0,
  };
  for (const row of rows) {
    if (row.isLoss) totals.lossCount += 1;
    totals.confirmedKopecks += row.confirmedKopecks;
    totals.expectedKopecks += row.expectedKopecks;
    if (row.netKopecks === null) totals.unknownCount += 1;
    else totals.netKopecks += row.netKopecks;
  }
  return totals;
}
