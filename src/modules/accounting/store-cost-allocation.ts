/**
 * Распределение общих расходов магазина по заказам «Финучёта» (TASK-219, ТЗ п.7, п.8).
 *
 * Реклама уровня кампании, общие операционные расходы (операции без номера заказа) и
 * налог периода ложатся на заказы только по явно выбранной методике продавца
 * (решение `accounting_allocation_method`) и всегда как `allocated` с названием
 * методики (`accounting_allocated_is_labeled`): в фактические строки заказа
 * (`advertising` и др.) распределённое не попадает никогда.
 *
 * Нераспределённое (методика «не распределять», нет базы, не расход) не теряется —
 * отдельный список с суммой; allocated + unallocated = Σ входа до копейки.
 *
 * Копейки делит `splitKopecks` (наибольший остаток), а не `expense-allocation.allocate`
 * — то раскладка расхода по дням периода с `Math.round`, сумму до копейки не держит.
 */

import type { IOrderAllocated, IOrderAllocations } from './order-result';
import type { TFinanceArticle } from '../finance/finance-articles';

import { FINANCE_ARTICLE_META } from '../finance/finance-articles';
import { splitKopecks } from '../finance/pnl-sku';

export type TAllocationMethod = 'none' | 'revenue_share' | 'units_share';

export const ALLOCATION_METHOD_TITLE: Record<TAllocationMethod, string> = {
  none: 'Не распределять',
  revenue_share: 'Пропорционально выручке',
  units_share: 'Пропорционально штукам',
};

/** Нет строки настроек — по выручке (ТЗ п.7). */
export const DEFAULT_ALLOCATION_METHOD: TAllocationMethod = 'revenue_share';

export function isAllocationMethod(value: unknown): value is TAllocationMethod {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ALLOCATION_METHOD_TITLE, value)
  );
}

/** Вид общего расхода — слот карточки заказа (`IOrderAllocations`). */
export type TStoreCostKind = 'advertising' | 'opex' | 'tax';

const STORE_COST_KINDS: Record<TStoreCostKind, true> = { advertising: true, opex: true, tax: true };
const KINDS = Object.keys(STORE_COST_KINDS) as TStoreCostKind[];

/**
 * Статья операции без заказа → вид расхода. Продвижение — реклама; прочие расходы
 * и нераспознанное — общие расходы; доходы и справочное — `null`: распределять
 * их как расход нельзя, они уходят в нераспределённое (`not-a-cost`).
 */
export function storeCostKindOf(article: TFinanceArticle): TStoreCostKind | null {
  if (article === 'promotion') return 'advertising';
  const group = FINANCE_ARTICLE_META[article].group;
  return group === 'expense' || group === 'unknown' ? 'opex' : null;
}

/** Заказ периода — база распределения. */
export interface IAllocationOrder {
  orderId: string;
  /** Выручка продавца заказа, копейки; ≤ 0 или null — в базу «по выручке» не входит. */
  revenueKopecks: number | null;
  /** Штуки заказа; ≤ 0 или null — в базу «по штукам» не входит. */
  units: number | null;
}

/** Общий расход: операция без заказа (журнал/ручная) или налог периода. */
export interface IStoreCostItem {
  id: string;
  /** null — не расход (доход/справочное без заказа): только в нераспределённое. */
  kind: TStoreCostKind | null;
  /** Копейки со знаком (расход — минус). */
  kopecks: number;
  title: string;
  article?: TFinanceArticle;
  accruedOn?: string | null;
  /** `expense` — расход продавца из «Расходов» (TASK-220). */
  source?: 'journal' | 'manual' | 'tax' | 'expense';
}

export type TUnallocatedReason = 'method-none' | 'no-base' | 'not-a-cost';

export interface IUnallocatedItem extends IStoreCostItem {
  reason: TUnallocatedReason;
}

export interface IStoreCostAllocation {
  method: TAllocationMethod;
  methodTitle: string;
  /** Распределённое по заказам; заказа без доли здесь нет. */
  byOrder: Map<string, IOrderAllocations>;
  /** Σ распределённого по виду. */
  allocatedKopecks: Record<TStoreCostKind, number>;
  unallocated: { items: IUnallocatedItem[]; totalKopecks: number };
  /** Σ входа — итог периода, от методики не зависит. */
  totalKopecks: number;
}

export interface IStoreCostAllocationInput {
  method: TAllocationMethod;
  orders: readonly IAllocationOrder[];
  items: readonly IStoreCostItem[];
}

const positive = (value: number | null): number =>
  typeof value === 'number' && value > 0 ? value : 0;

function weightOf(method: Exclude<TAllocationMethod, 'none'>, order: IAllocationOrder): number {
  return method === 'revenue_share' ? positive(order.revenueKopecks) : positive(order.units);
}

const sumOf = (items: readonly { kopecks: number }[]) =>
  items.reduce((acc, item) => acc + item.kopecks, 0);

/** Распределить общие расходы периода по заказам по методике продавца. */
export function allocateStoreCosts(input: IStoreCostAllocationInput): IStoreCostAllocation {
  const { method, orders, items } = input;
  const methodTitle = ALLOCATION_METHOD_TITLE[method];
  const byOrder = new Map<string, IOrderAllocations>();
  const allocatedKopecks: Record<TStoreCostKind, number> = { advertising: 0, opex: 0, tax: 0 };
  const unallocated: IUnallocatedItem[] = [];

  const base =
    method === 'none'
      ? []
      : orders
          .map((order) => ({ orderId: order.orderId, weight: weightOf(method, order) }))
          .filter((o) => o.weight > 0);

  for (const item of items) {
    if (item.kind === null) unallocated.push({ ...item, reason: 'not-a-cost' });
  }

  for (const kind of KINDS) {
    const ofKind = items.filter((item) => item.kind === kind);
    if (!ofKind.length) continue;
    // splitKopecks бросает при Σ весов ≤ 0 — отсекаем до вызова.
    if (method === 'none' || !base.length) {
      const reason: TUnallocatedReason = method === 'none' ? 'method-none' : 'no-base';
      for (const item of ofKind) unallocated.push({ ...item, reason });
      continue;
    }
    const amount = sumOf(ofKind);
    const parts = splitKopecks(
      amount,
      base.map((o) => o.weight),
    );
    base.forEach((order, index) => {
      if (parts[index] === 0) return;
      const value: IOrderAllocated = { kopecks: parts[index], method: methodTitle };
      byOrder.set(order.orderId, { ...byOrder.get(order.orderId), [kind]: value });
    });
    allocatedKopecks[kind] = amount;
  }

  return {
    method,
    methodTitle,
    byOrder,
    allocatedKopecks,
    unallocated: { items: unallocated, totalKopecks: sumOf(unallocated) },
    totalKopecks: sumOf(items),
  };
}
