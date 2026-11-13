/**
 * Расходы продавца (`finance_expenses`) в карточке заказа «Финучёта» (TASK-220, ТЗ п.8).
 *
 * - Привязанный к **заказу** — целиком на этот заказ: заказ сам задаёт месяц своей
 *   карточки. Заказа нет среди заказов месяца — расход принадлежит другому месяцу и
 *   здесь не считается (ни распределённым, ни нераспределённым).
 * - Привязанный к **товару** — доля месяца по штукам этого артикула среди заказов
 *   месяца (площадка задана — только её заказы). Нет таких штук — нераспределённое
 *   `no-base`, сумма не теряется.
 * - **Площадка** и **весь бизнес** (и записи до v2) — общий расход: `expenseCostItemOf`
 *   превращает их в `IStoreCostItem` вида `opex`, дальше — методика TASK-219.
 *
 * Привязанное к заказу/товару — строка «Прочие расходы» (`other_expenses`), тоже
 * `allocated`: это не операция площадки, а запись продавца (`accounting_allocated_is_labeled`).
 */

import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { IOrderAllocations, IOrderExpenseShare } from './order-result';
import type { IStoreCostItem, IUnallocatedItem } from './store-cost-allocation';
import type { IAccountingExpense } from '../finance/finance-expenses.service';

import { splitKopecks } from '../finance/pnl-sku';

import { orderKeyOf } from './accounting-order-card.domain';
import { isGoneOrderLine } from './order-result';

export const ORDER_EXPENSE_METHOD = 'Расход заказа';
export const PRODUCT_EXPENSE_METHOD = 'По штукам товара';

/** Расход бизнеса/площадки → общий расход магазина (знак журнала: расход — минус). */
export function expenseCostItemOf(expense: IAccountingExpense, title: string): IStoreCostItem {
  return {
    id: expense.row.id,
    kind: 'opex',
    kopecks: -expense.kopecks,
    title,
    accruedOn: expense.row.fromDay,
    source: 'expense',
  };
}

/** Общий расход (бизнес или площадка) — не привязан к заказу или товару. */
export function isStoreLevelExpense(expense: IAccountingExpense): boolean {
  return expense.row.scope !== 'order' && expense.row.scope !== 'product';
}

export interface IBoundExpenseAllocation {
  byOrder: Map<string, IOrderAllocations>;
  unallocated: { items: IUnallocatedItem[]; totalKopecks: number };
}

/** Расходы заказа и товара месяца → «Прочие расходы» заказов. */
export function allocateBoundExpenses(input: {
  byOrder: ReadonlyMap<string, readonly IAccountingOrderLineInput[]>;
  expenses: readonly IAccountingExpense[];
  titleOf: (expense: IAccountingExpense) => string;
}): IBoundExpenseAllocation {
  const shares = new Map<string, IOrderExpenseShare[]>();
  const unallocated: IUnallocatedItem[] = [];
  const add = (key: string, share: IOrderExpenseShare) => {
    shares.set(key, [...(shares.get(key) ?? []), share]);
  };

  for (const expense of input.expenses) {
    const { row } = expense;
    const title = input.titleOf(expense);
    if (row.scope === 'order') {
      if (!row.marketplace || !row.orderId) continue;
      const key = orderKeyOf(row.marketplace, row.orderId);
      if (!input.byOrder.has(key)) continue;
      add(key, { id: row.id, title, kopecks: -expense.kopecks, method: ORDER_EXPENSE_METHOD });
    } else if (row.scope === 'product') {
      const base: { key: string; units: number }[] = [];
      for (const [key, lines] of input.byOrder) {
        const units = lines
          .filter(
            (line) =>
              line.offerId === row.sku &&
              (!row.marketplace || line.marketplace === row.marketplace) &&
              !isGoneOrderLine(line),
          )
          .reduce((sum, line) => sum + line.count, 0);
        if (units > 0) base.push({ key, units });
      }
      if (!base.length) {
        unallocated.push({ ...expenseCostItemOf(expense, title), reason: 'no-base' });
        continue;
      }
      const parts = splitKopecks(
        -expense.kopecks,
        base.map((b) => b.units),
      );
      base.forEach((b, index) => {
        if (parts[index] !== 0) {
          add(b.key, { id: row.id, title, kopecks: parts[index], method: PRODUCT_EXPENSE_METHOD });
        }
      });
    }
  }

  const byOrder = new Map<string, IOrderAllocations>();
  for (const [key, list] of shares) {
    const methods = [...new Set(list.map((s) => s.method))];
    byOrder.set(key, {
      other: {
        kopecks: list.reduce((sum, s) => sum + s.kopecks, 0),
        method: methods.join(', '),
        expenses: list,
      },
    });
  }
  return {
    byOrder,
    unallocated: {
      items: unallocated,
      totalKopecks: unallocated.reduce((sum, item) => sum + item.kopecks, 0),
    },
  };
}
