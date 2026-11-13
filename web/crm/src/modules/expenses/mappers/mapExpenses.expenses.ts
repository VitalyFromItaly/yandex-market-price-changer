import type {
  Expense,
  ExpenseBody,
  ExpenseCategory,
  ExpenseErrors,
  ExpenseField,
  ExpenseForm,
  ExpenseKind,
  ExpenseMarketplace,
  ExpenseRow,
  ExpenseScope,
} from '../expenses.domain';

import { EXPENSE_ERROR_CODE } from '../expenses.domain';

import { ApiError } from '@/shared/http';
import { formatDay, formatRub } from '@/shared/utils';

export const KIND_OPTIONS: readonly { value: ExpenseKind; label: string }[] = [
  { value: 'monthly', label: 'Ежемесячный' },
  { value: 'one_off', label: 'Разовый' },
  { value: 'period', label: 'За период' },
];

const KIND_LABEL: Record<ExpenseKind, string> = {
  monthly: 'Ежемесячно',
  one_off: 'Разово',
  period: 'За период',
};

const MARKETPLACE_LABEL: Record<ExpenseMarketplace, string> = {
  ym: 'Яндекс Маркет',
  ozon: 'Ozon',
  wb: 'Wildberries',
};

export const MARKETPLACE_OPTIONS: readonly { value: ExpenseMarketplace; label: string }[] = (
  Object.keys(MARKETPLACE_LABEL) as ExpenseMarketplace[]
).map((value) => ({ value, label: MARKETPLACE_LABEL[value] }));

const FIELD_SET: Record<ExpenseField, true> = {
  kind: true,
  category: true,
  amount: true,
  fromDay: true,
  toDay: true,
  note: true,
  source: true,
  scope: true,
  marketplace: true,
  orderId: true,
  sku: true,
};
const FIELDS = Object.keys(FIELD_SET) as ExpenseField[];

export { formatDay };

export function kopecksToRubText(kopecks: number): string {
  return formatRub(kopecks / 100);
}

function whenLabel(expense: Expense): string {
  if (expense.kind === 'one_off') return formatDay(expense.fromDay);
  if (expense.toDay === null) return `с ${formatDay(expense.fromDay)}`;
  return `${formatDay(expense.fromDay)} — ${formatDay(expense.toDay)}`;
}

function bindingLabel(expense: Expense): string | null {
  const market = expense.marketplace ? MARKETPLACE_LABEL[expense.marketplace] : null;
  if (expense.scope === 'marketplace') return market;
  if (expense.scope === 'order')
    return `Заказ ${expense.orderId ?? ''}${market ? `, ${market}` : ''}`;
  if (expense.scope === 'product')
    return `Товар ${expense.sku ?? ''}${market ? `, ${market}` : ''}`;
  return null;
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
    bindingLabel: bindingLabel(expense),
    doubleCountHint: expense.doubleCount
      ? `Площадка уже начисляет «${expense.doubleCount}» — возможен двойной учёт`
      : null,
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
    return {
      kind: 'monthly',
      category: 'rent',
      amount: '',
      fromDay: today,
      toDay: '',
      note: '',
      source: '',
      scope: 'business',
      marketplace: '',
      orderId: '',
      sku: '',
    };
  }
  return {
    kind: expense.kind,
    category: expense.category,
    amount: amountInput(expense.amountKopecks),
    fromDay: expense.fromDay,
    toDay: expense.toDay ?? '',
    note: expense.note ?? '',
    source: expense.source ?? '',
    scope: expense.scope,
    marketplace: expense.marketplace ?? '',
    orderId: expense.orderId ?? '',
    sku: expense.sku ?? '',
  };
}

const textOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Поля привязки — только нужные выбранной: лишние сервер отбросил бы и сам. */
function binding(form: ExpenseForm): Pick<ExpenseBody, 'marketplace' | 'orderId' | 'sku'> {
  const scope: ExpenseScope = form.scope;
  const marketplace = scope === 'business' || form.marketplace === '' ? null : form.marketplace;
  return {
    marketplace,
    orderId: scope === 'order' ? textOrNull(form.orderId) : null,
    sku: scope === 'product' ? textOrNull(form.sku) : null,
  };
}

export function expenseBody(form: ExpenseForm): ExpenseBody {
  return {
    kind: form.kind,
    category: form.category,
    amount: form.amount.trim(),
    fromDay: form.fromDay,
    toDay: form.kind !== 'one_off' && form.toDay !== '' ? form.toDay : null,
    note: textOrNull(form.note),
    source: textOrNull(form.source),
    scope: form.scope,
    ...binding(form),
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
