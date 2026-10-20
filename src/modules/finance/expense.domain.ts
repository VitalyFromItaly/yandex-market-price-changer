/**
 * Операционные расходы бизнеса (TASK-121, ТЗ п.3 «Расходы бизнеса»): виды
 * записей, предустановленные категории, проверка ввода. Чистые функции — без
 * Nest и базы; проверяют и CRM-контроллер, и любой будущий канал ввода, чтобы
 * правило было одно.
 */

import type { TFinanceExpenseCategoryRow } from '../../database/postgres/repositories/finance-expense.repository';

import { toKopecks } from './kopecks';

/**
 * `one_off` — разовая трата в конкретный день; `monthly` — повторяется каждый
 * месяц с дня начала до дня конца (или без конца) и распределяется по дням
 * своего месяца (решение `expenses_allocation_month_days`).
 */
export const EXPENSE_KINDS = ['one_off', 'monthly'] as const;
export type TExpenseKind = (typeof EXPENSE_KINDS)[number];

/**
 * Предустановленные категории — константа в коде, а не строки в базе: подпись
 * одна на всех продавцов, и правка формулировки не требует миграции данных.
 * Свои категории продавца лежат в `finance_expense_categories`, у записи
 * расхода тогда в `category` — uuid такой категории.
 */
export const EXPENSE_CATEGORIES = {
  supplier_delivery: 'Доставка от поставщика',
  packaging: 'Упаковка',
  warehouse: 'Содержание склада',
  salaries: 'Зарплаты',
  rent: 'Аренда',
  other: 'Прочее',
} as const;
export type TPresetExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const PRESET_EXPENSE_CATEGORIES = Object.keys(
  EXPENSE_CATEGORIES,
) as TPresetExpenseCategory[];

export function isPresetCategory(value: unknown): value is TPresetExpenseCategory {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, value)
  );
}

/** Подпись категории; удалённая своя (запись осталась от гонки) — «Без категории». */
export function labelResolver(categories: readonly TFinanceExpenseCategoryRow[]) {
  const custom = new Map(categories.map((row) => [row.id, row.name]));
  return (key: string): string =>
    isPresetCategory(key) ? EXPENSE_CATEGORIES[key] : (custom.get(key) ?? 'Без категории');
}

/** 10 млрд ₽ в копейках: больше — опечатка, а не расход; и далеко внутри 2^53 при × 31. */
export const MAX_EXPENSE_KOPECKS = 1_000_000_000_000;
export const MAX_EXPENSE_NOTE_LENGTH = 200;
export const MAX_EXPENSE_CATEGORY_NAME_LENGTH = 60;

/** Проверенный расход — то, что пишется в базу. */
export interface IExpenseValue {
  kind: TExpenseKind;
  category: string;
  amountKopecks: number;
  /** ГГГГ-ММ-ДД: у разовой — её день, у ежемесячной — начало. */
  fromDay: string;
  /** ГГГГ-ММ-ДД включительно; только у ежемесячной, null — без конца. */
  toDay: string | null;
  note: string | null;
}

export type TExpenseField = 'kind' | 'category' | 'amount' | 'fromDay' | 'toDay' | 'note';

export type TExpenseValidation =
  | { ok: true; value: IExpenseValue }
  | { ok: false; field: TExpenseField; error: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** «ГГГГ-ММ-ДД», и такой день существует (не 2026-02-30). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const fail = (field: TExpenseField, error: string): TExpenseValidation => ({
  ok: false,
  field,
  error,
});

/**
 * Ввод расхода → проверенное значение или первая ошибка с полем (форма ставит
 * её под это поле). Сумма — рубли числом или строкой («30 000,50»), разбирает
 * `toKopecks` журнала: одно правило копеек на весь финмодуль.
 */
export function validateExpenseInput(
  input: Record<string, unknown>,
  customCategoryIds: ReadonlySet<string>,
): TExpenseValidation {
  const kind = input.kind;
  if (kind !== 'one_off' && kind !== 'monthly') {
    return fail('kind', 'Выберите вид расхода: разовый или ежемесячный');
  }

  const category = input.category;
  if (
    typeof category !== 'string' ||
    !(isPresetCategory(category) || customCategoryIds.has(category))
  ) {
    return fail('category', 'Выберите категорию из списка');
  }

  const amountKopecks = toKopecks(input.amount);
  if (amountKopecks === null) return fail('amount', 'Сумма — число в рублях, например 30000');
  if (amountKopecks <= 0) return fail('amount', 'Сумма должна быть больше нуля');
  if (amountKopecks > MAX_EXPENSE_KOPECKS) return fail('amount', 'Слишком большая сумма');

  const fromDay = input.fromDay;
  if (!isIsoDay(fromDay)) {
    return fail('fromDay', kind === 'one_off' ? 'Укажите дату расхода' : 'Укажите дату начала');
  }

  let toDay: string | null = null;
  if (
    kind === 'monthly' &&
    input.toDay !== undefined &&
    input.toDay !== null &&
    input.toDay !== ''
  ) {
    if (!isIsoDay(input.toDay)) return fail('toDay', 'Дата окончания указана неверно');
    if (input.toDay < fromDay) return fail('toDay', 'Окончание раньше начала');
    toDay = input.toDay;
  }

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') return fail('note', 'Комментарий — текст');
    const trimmed = input.note.trim();
    if (trimmed.length > MAX_EXPENSE_NOTE_LENGTH) {
      return fail('note', `Комментарий длиннее ${MAX_EXPENSE_NOTE_LENGTH} символов`);
    }
    note = trimmed || null;
  }

  return { ok: true, value: { kind, category, amountKopecks, fromDay, toDay, note } };
}

export type TCategoryNameValidation = { ok: true; value: string } | { ok: false; error: string };

/**
 * Имя своей категории: непустое, не длиннее потолка и не повторяет ни
 * предустановленную, ни уже заведённую (без учёта регистра) — две «Аренды» в
 * разбивке читались бы как ошибка отчёта.
 */
export function validateCategoryName(
  value: unknown,
  existingNames: readonly string[],
): TCategoryNameValidation {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Введите название категории' };
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > MAX_EXPENSE_CATEGORY_NAME_LENGTH) {
    return {
      ok: false,
      error: `Название длиннее ${MAX_EXPENSE_CATEGORY_NAME_LENGTH} символов`,
    };
  }
  const lower = name.toLocaleLowerCase('ru');
  const taken = [...Object.values(EXPENSE_CATEGORIES), ...existingNames].some(
    (existing) => existing.toLocaleLowerCase('ru') === lower,
  );
  if (taken) return { ok: false, error: 'Такая категория уже есть' };
  return { ok: true, value: name };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * id из адреса — uuid? Postgres на не-uuid отвечает ошибкой синтаксиса, а не
 * «нет строки», и `/expenses/abc` вышел бы 500 вместо 404.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
