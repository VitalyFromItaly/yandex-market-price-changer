import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type {
  TFinanceExpenseCategoryRow,
  TFinanceExpenseRow,
} from '../../../database/postgres/repositories/finance-expense.repository';
import type { IExpenseAllocation } from '../../finance/expense-allocation';
import type { TExpenseKind, TExpenseScope } from '../../finance/expense.domain';
import type { IExpensesSnapshot } from '../../finance/finance-expenses.service';

import {
  EXPENSE_CATEGORIES,
  EXPENSE_SCOPE_TITLE,
  MAX_EXPENSE_CATEGORY_NAME_LENGTH,
  MAX_EXPENSE_NOTE_LENGTH,
  MAX_EXPENSE_REF_LENGTH,
  MAX_EXPENSE_SOURCE_LENGTH,
  PRESET_EXPENSE_CATEGORIES,
  doubleCountWarningOf,
  labelResolver,
} from '../../finance/expense.domain';
import { FINANCE_ARTICLE_META } from '../../finance/finance-articles';

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
  /** v2 (TASK-220): источник, привязка; `scope` у записей до v2 — `business`. */
  source: string | null;
  scope: TExpenseScope;
  scopeLabel: string;
  marketplace: TFinanceMarketplace | null;
  orderId: string | null;
  sku: string | null;
  /** Подпись статьи реестра, которую расход повторял при сохранении; null — не повторял. */
  doubleCount: string | null;
}

export interface ICrmExpensesView {
  categories: ICrmExpenseCategoryView[];
  /** Привязки расхода по порядку формы. */
  scopes: { key: TExpenseScope; label: string }[];
  expenses: ICrmExpenseView[];
  limits: {
    noteMaxLength: number;
    categoryNameMaxLength: number;
    sourceMaxLength: number;
    refMaxLength: number;
  };
}

/** Ответ сохранения: вид раздела + предупреждение о двойном учёте (TASK-220). */
export interface ICrmExpensesSaveView extends ICrmExpensesView {
  warning: string | null;
}

export function expenseWarningOf(row: Pick<TFinanceExpenseRow, 'doubleCountArticle'>) {
  return doubleCountWarningOf(row.doubleCountArticle);
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
    source: row.source,
    scope: row.scope ?? 'business',
    scopeLabel: EXPENSE_SCOPE_TITLE[row.scope ?? 'business'],
    marketplace: row.marketplace,
    orderId: row.orderId,
    sku: row.sku,
    doubleCount: row.doubleCountArticle ? FINANCE_ARTICLE_META[row.doubleCountArticle].title : null,
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
    scopes: (Object.keys(EXPENSE_SCOPE_TITLE) as TExpenseScope[]).map((key) => ({
      key,
      label: EXPENSE_SCOPE_TITLE[key],
    })),
    expenses: snapshot.expenses.map((row) => toCrmExpenseView(row, labelOf)),
    limits: {
      noteMaxLength: MAX_EXPENSE_NOTE_LENGTH,
      categoryNameMaxLength: MAX_EXPENSE_CATEGORY_NAME_LENGTH,
      sourceMaxLength: MAX_EXPENSE_SOURCE_LENGTH,
      refMaxLength: MAX_EXPENSE_REF_LENGTH,
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
