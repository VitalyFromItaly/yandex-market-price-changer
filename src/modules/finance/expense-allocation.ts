/**
 * Распределение операционных расходов на произвольный период (TASK-121).
 * Чистая функция: её зовёт CRM для предпросмотра и будет звать движок P&L
 * (TASK-120) — одно правило, а не два, иначе «Расходы» и P&L разойдутся.
 *
 * - Разовый расход попадает в период целиком, если его день внутри периода.
 * - Ежемесячный делится по дням СВОЕГО месяца (решение
 *   `expenses_allocation_month_days`): 30 000 ₽ в октябре — 30 000 / 31 в день.
 *   Поэтому полный месяц даёт ровно сумму, а не «×12/365».
 * - Расход «за период» (TASK-220) делится по дням своего периода признания.
 * - Округление — на кусок месяца, не на день: `round(сумма × дней / дней в
 *   месяце)`. Округляй мы каждый день, 31 округление полного месяца дали бы
 *   30 000,01 вместо 30 000.
 *
 * Дни — «ГГГГ-ММ-ДД» (как `IFinancePeriod`); такие строки сравниваются
 * лексикографически без разбора.
 */

import type { TExpenseKind } from './expense.domain';
import type { IFinancePeriod } from './finance-period';

import { daysInMonth } from '../yandex/reports/moscow-day';

export interface IAllocatableExpense {
  id: string;
  category: string;
  kind: TExpenseKind;
  amountKopecks: number;
  fromDay: string;
  toDay: string | null;
}

export interface IExpenseAllocation {
  totalKopecks: number;
  /** Ненулевые доли по категориям; Σ = totalKopecks по построению. */
  byCategory: Record<string, number>;
  /** Ненулевые доли по записям; Σ = totalKopecks по построению. */
  byExpense: { id: string; kopecks: number }[];
}

const DAY_MS = 86_400_000;

const pad2 = (n: number) => String(n).padStart(2, '0');

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Доля ежемесячного расхода в отрезке [start, end] (оба включительно, start ≤ end). */
function monthlyShare(amountKopecks: number, start: string, end: string): number {
  let share = 0;
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const lastKey = end.slice(0, 7);
  for (;;) {
    const key = `${year}-${pad2(month)}`;
    const dim = daysInMonth(year, month);
    const first = `${key}-01`;
    const last = `${key}-${pad2(dim)}`;
    const from = start > first ? start : first;
    const to = end < last ? end : last;
    const days = dayNumber(to) - dayNumber(from) + 1;
    share += Math.round((amountKopecks * days) / dim);
    if (key === lastKey) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return share;
}

/**
 * Расход за период признания (TASK-220, решение `expenses_v2_period_kind`):
 * сумма делится по дням СВОЕГО периода, одно округление на пересечение —
 * весь период даёт ровно сумму. Без конца (битая запись) — как разовый.
 */
function periodShare(expense: IAllocatableExpense, period: IFinancePeriod): number {
  const own = { from: expense.fromDay, to: expense.toDay ?? expense.fromDay };
  const start = own.from > period.from ? own.from : period.from;
  const end = own.to < period.to ? own.to : period.to;
  if (start > end) return 0;
  const days = dayNumber(end) - dayNumber(start) + 1;
  const total = dayNumber(own.to) - dayNumber(own.from) + 1;
  return Math.round((expense.amountKopecks * days) / total);
}

/** Сколько копеек расхода приходится на период. */
export function expenseShare(expense: IAllocatableExpense, period: IFinancePeriod): number {
  if (expense.kind === 'one_off') {
    return expense.fromDay >= period.from && expense.fromDay <= period.to
      ? expense.amountKopecks
      : 0;
  }
  if (expense.kind === 'period') return periodShare(expense, period);
  const start = expense.fromDay > period.from ? expense.fromDay : period.from;
  const until = expense.toDay ?? period.to;
  const end = until < period.to ? until : period.to;
  if (start > end) return 0;
  return monthlyShare(expense.amountKopecks, start, end);
}

/** Расходы на период: итог, по категориям и по записям — один проход. */
export function allocate(
  expenses: readonly IAllocatableExpense[],
  period: IFinancePeriod,
): IExpenseAllocation {
  const result: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };
  for (const expense of expenses) {
    const kopecks = expenseShare(expense, period);
    if (!kopecks) continue;
    result.totalKopecks += kopecks;
    result.byCategory[expense.category] = (result.byCategory[expense.category] ?? 0) + kopecks;
    result.byExpense.push({ id: expense.id, kopecks });
  }
  return result;
}
