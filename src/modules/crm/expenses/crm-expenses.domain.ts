import type {
  TFinanceExpenseCategoryRow,
  TFinanceExpenseRow,
} from '../../../database/postgres/repositories/finance-expense.repository';
import type { IExpenseAllocation } from '../../finance/expense-allocation';
import type { TExpenseKind } from '../../finance/expense.domain';
import type { IExpensesSnapshot } from '../../finance/finance-expenses.service';

import {
  EXPENSE_CATEGORIES,
  MAX_EXPENSE_CATEGORY_NAME_LENGTH,
  MAX_EXPENSE_NOTE_LENGTH,
  PRESET_EXPENSE_CATEGORIES,
  labelResolver,
} from '../../finance/expense.domain';

/**
 * Раздел «Расходы» CRM (TASK-121): вид для фронта. Правила ввода — в
 * expense.domain.ts финмодуля, здесь только сборка ответа перечислением полей
 * (`telegramUserId` наружу не уходит — правило `/auth/me`).
 */

/** 400: ввод не принят; `field` — под каким полем показать ошибку. */
export const INVALID_EXPENSE = 'INVALID_EXPENSE';
/** 404: записи или категории нет (или она чужая). */
export const EXPENSE_NOT_FOUND = 'EXPENSE_NOT_FOUND';
/** 409: своя категория занята записями. */
export const CATEGORY_IN_USE = 'CATEGORY_IN_USE';

export interface ICrmExpenseCategoryView {
  /** Ключ предустановленной категории или uuid своей — то, что шлёт форма. */
  key: string;
  label: string;
  custom: boolean;
}

export interface ICrmExpenseView {
  id: string;
  kind: TExpenseKind;
  category: string;
  categoryLabel: string;
  amountKopecks: number;
  fromDay: string;
  toDay: string | null;
  note: string | null;
}

export interface ICrmExpensesView {
  categories: ICrmExpenseCategoryView[];
  expenses: ICrmExpenseView[];
  limits: { noteMaxLength: number; categoryNameMaxLength: number };
}

export interface ICrmExpenseAllocationView {
  from: string;
  to: string;
  totalKopecks: number;
  /** По убыванию суммы; Σ = totalKopecks. */
  byCategory: { key: string; label: string; kopecks: number }[];
}

export function toCrmExpenseView(
  row: TFinanceExpenseRow,
  labelOf: (key: string) => string,
): ICrmExpenseView {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    categoryLabel: labelOf(row.category),
    amountKopecks: row.amountKopecks,
    fromDay: row.fromDay,
    toDay: row.toDay,
    note: row.note,
  };
}

export function toCrmExpensesView(snapshot: IExpensesSnapshot): ICrmExpensesView {
  const labelOf = labelResolver(snapshot.categories);
  return {
    categories: [
      ...PRESET_EXPENSE_CATEGORIES.map((key) => ({
        key,
        label: EXPENSE_CATEGORIES[key],
        custom: false,
      })),
      ...snapshot.categories.map((row) => ({ key: row.id, label: row.name, custom: true })),
    ],
    expenses: snapshot.expenses.map((row) => toCrmExpenseView(row, labelOf)),
    limits: {
      noteMaxLength: MAX_EXPENSE_NOTE_LENGTH,
      categoryNameMaxLength: MAX_EXPENSE_CATEGORY_NAME_LENGTH,
    },
  };
}

export function toCrmAllocationView(
  period: { from: string; to: string },
  allocation: IExpenseAllocation,
  categories: readonly TFinanceExpenseCategoryRow[],
): ICrmExpenseAllocationView {
  const labelOf = labelResolver(categories);
  return {
    from: period.from,
    to: period.to,
    totalKopecks: allocation.totalKopecks,
    byCategory: Object.entries(allocation.byCategory)
      .map(([key, kopecks]) => ({ key, label: labelOf(key), kopecks }))
      .sort((a, b) => b.kopecks - a.kopecks),
  };
}

/** Тело запроса — объект или пустой объект: разбор полей делает `validateExpenseInput`. */
export function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
