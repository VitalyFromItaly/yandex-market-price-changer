import type {
  Expense,
  ExpenseBody,
  ExpenseCategory,
  ExpenseErrors,
  ExpenseField,
  ExpenseForm,
  ExpenseKind,
  ExpenseRow,
} from '../expenses.domain';

import { EXPENSE_ERROR_CODE } from '../expenses.domain';

import { ApiError } from '@/shared/http';
import { formatDay, formatRub } from '@/shared/utils';

export const KIND_OPTIONS: readonly { value: ExpenseKind; label: string }[] = [
  { value: 'monthly', label: 'Ежемесячный' },
  { value: 'one_off', label: 'Разовый' },
];

const KIND_LABEL: Record<ExpenseKind, string> = { monthly: 'Ежемесячно', one_off: 'Разово' };

const FIELDS: readonly ExpenseField[] = ['kind', 'category', 'amount', 'fromDay', 'toDay', 'note'];

export { formatDay };

export function kopecksToRubText(kopecks: number): string {
  return formatRub(kopecks / 100);
}

function whenLabel(expense: Expense): string {
  if (expense.kind === 'one_off') return formatDay(expense.fromDay);
  if (expense.toDay === null) return `с ${formatDay(expense.fromDay)}`;
  return `${formatDay(expense.fromDay)} — ${formatDay(expense.toDay)}`;
}

export function toExpenseRow(expense: Expense): ExpenseRow {
  return {
    id: expense.id,
    categoryLabel: expense.categoryLabel,
    kindLabel: KIND_LABEL[expense.kind],
    whenLabel: whenLabel(expense),
    amount: kopecksToRubText(expense.amountKopecks),
    amountSuffix: expense.kind === 'monthly' ? 'в месяц' : null,
    note: expense.note,
  };
}

export function categoryOptions(
  categories: readonly ExpenseCategory[],
): { value: string; label: string }[] {
  return categories.map((category) => ({ value: category.key, label: category.label }));
}

/** Копейки → строка поля: «30000», «1250,5» — без пробелов, которые набирать неудобно. */
function amountInput(kopecks: number): string {
  return String(kopecks / 100).replace('.', ',');
}

/** Форма нового расхода или правки существующего. */
export function toExpenseForm(expense: Expense | null, today: string): ExpenseForm {
  if (expense === null) {
    return { kind: 'monthly', category: 'rent', amount: '', fromDay: today, toDay: '', note: '' };
  }
  return {
    kind: expense.kind,
    category: expense.category,
    amount: amountInput(expense.amountKopecks),
    fromDay: expense.fromDay,
    toDay: expense.toDay ?? '',
    note: expense.note ?? '',
  };
}

export function expenseBody(form: ExpenseForm): ExpenseBody {
  const note = form.note.trim();
  return {
    kind: form.kind,
    category: form.category,
    amount: form.amount.trim(),
    fromDay: form.fromDay,
    toDay: form.kind === 'monthly' && form.toDay !== '' ? form.toDay : null,
    note: note === '' ? null : note,
  };
}

/** Ошибка сервера → под своё поле; без поля — общей строкой формы. */
export function mapExpenseError(error: unknown, fallback: string): ExpenseErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === EXPENSE_ERROR_CODE.INVALID_EXPENSE &&
    error.field !== null &&
    (FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}
