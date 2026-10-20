/**
 * Раздел «Расходы» (TASK-121): операционные расходы бизнеса продавца — аренда,
 * зарплаты, упаковка и свои категории. Распределение на период считает сервер
 * тем же `allocate`, что возьмёт P&L; фронт только показывает.
 */

export type ExpenseKind = 'one_off' | 'monthly';

export interface ExpenseCategory {
  /** Ключ предустановленной категории или uuid своей — то, что уходит в форме. */
  key: string;
  label: string;
  custom: boolean;
}

export interface Expense {
  id: string;
  kind: ExpenseKind;
  category: string;
  categoryLabel: string;
  amountKopecks: number;
  /** ГГГГ-ММ-ДД: у разового — день, у ежемесячного — начало. */
  fromDay: string;
  /** ГГГГ-ММ-ДД включительно; null — без конца (и всегда у разового). */
  toDay: string | null;
  note: string | null;
}

export interface ExpensesView {
  categories: ExpenseCategory[];
  expenses: Expense[];
  limits: { noteMaxLength: number; categoryNameMaxLength: number };
}

/** Ответ API совпадает с видом: сервер уже перечисляет поля сам. */
export type ExpensesResponse = ExpensesView;

export interface ExpenseAllocation {
  from: string;
  to: string;
  totalKopecks: number;
  byCategory: { key: string; label: string; kopecks: number }[];
}

export type ExpenseAllocationResponse = ExpenseAllocation;

/** Пресеты периода распределения. */
export type AllocationPreset = 'month' | 'prevmonth' | 'week';

export interface AllocationRange {
  from: string;
  to: string;
}

/** Строки ввода формы; разбирает и проверяет их сервер. */
export interface ExpenseForm {
  kind: ExpenseKind;
  category: string;
  amount: string;
  fromDay: string;
  toDay: string;
  note: string;
}

export interface ExpenseBody {
  kind: ExpenseKind;
  category: string;
  amount: string;
  fromDay: string;
  toDay: string | null;
  note: string | null;
}

export type ExpenseField = 'kind' | 'category' | 'amount' | 'fromDay' | 'toDay' | 'note';

/** Ошибка под полем формы; `form` — общая, без поля. */
export type ExpenseErrors = Partial<Record<ExpenseField | 'form', string>>;

/** Строка таблицы — уже готовые подписи. */
export interface ExpenseRow {
  id: string;
  categoryLabel: string;
  kindLabel: string;
  /** «с 01-10-2026» / «01-10-2026 — 31-12-2026» / «15-10-2026». */
  whenLabel: string;
  amount: string;
  /** «в месяц» у ежемесячного, null у разового. */
  amountSuffix: string | null;
  note: string | null;
}

export interface AllocationModel {
  rangeLabel: string;
  total: string;
  isEmpty: boolean;
  byCategory: { key: string; label: string; amount: string }[];
}

export const EXPENSE_ERROR_CODE = {
  INVALID_EXPENSE: 'INVALID_EXPENSE',
  EXPENSE_NOT_FOUND: 'EXPENSE_NOT_FOUND',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
} as const;
