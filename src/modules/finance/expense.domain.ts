/**
 * Операционные расходы бизнеса (TASK-121, ТЗ п.3 «Расходы бизнеса»): виды
 * записей, предустановленные категории, проверка ввода. Чистые функции — без
 * Nest и базы; проверяют и CRM-контроллер, и любой будущий канал ввода, чтобы
 * правило было одно.
 */

import type { TFinanceArticle } from './finance-articles';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceExpenseCategoryRow } from '../../database/postgres/repositories/finance-expense.repository';

import { FINANCE_ARTICLE_META } from './finance-articles';
import { toKopecks } from './kopecks';

/**
 * `one_off` — разовая трата в конкретный день; `monthly` — повторяется каждый
 * месяц с дня начала до дня конца (или без конца) и распределяется по дням
 * своего месяца (решение `expenses_allocation_month_days`); `period` — одна
 * сумма на произвольный период признания [fromDay, toDay], ровно по дням
 * периода (TASK-220, решение `expenses_v2_period_kind`).
 */
export const EXPENSE_KINDS = ['one_off', 'monthly', 'period'] as const;
export type TExpenseKind = (typeof EXPENSE_KINDS)[number];

/**
 * К чему относится расход в «Финучёте» (TASK-220, решение `expenses_v2_scope`):
 * весь бизнес, площадка, заказ, товар. NULL в базе — `business`: так читаются
 * все записи до v2. Текущий P&L привязку не читает — расход в нём общий.
 */
export const EXPENSE_SCOPE_TITLE = {
  business: 'Весь бизнес',
  marketplace: 'Площадка',
  order: 'Заказ',
  product: 'Товар',
} as const satisfies Record<string, string>;
export type TExpenseScope = keyof typeof EXPENSE_SCOPE_TITLE;

export function isExpenseScope(value: unknown): value is TExpenseScope {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXPENSE_SCOPE_TITLE, value)
  );
}

const MARKETPLACES: Record<TFinanceMarketplace, true> = { ym: true, ozon: true, wb: true };

function isMarketplace(value: unknown): value is TFinanceMarketplace {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MARKETPLACES, value);
}

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
  // TASK-220 (ТЗ п.8): недостающие категории; ключи старых не меняются — они в записях.
  // Не «Подписки»: слово занято забором subscription-removed.test.ts, как у статьи реестра.
  marketplace_subscriptions: 'Абонентская плата площадок',
  advertising: 'Реклама',
  website: 'Сайт',
  servers_software: 'Серверы и ПО',
  bank: 'Банк',
  accounting: 'Бухгалтерия',
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

/**
 * Категория, которую площадка может уже начислять в реестре «Финучёта», → её
 * статья (решение `expenses_v2_double_count`). Совпало за окно признания —
 * предупреждение и флаг на расходе, сохранение не блокируется: продавец мог
 * завести, например, рекламу у блогера, а не на площадке.
 */
export const EXPENSE_REGISTRY_ARTICLE: Partial<Record<TPresetExpenseCategory, TFinanceArticle>> = {
  marketplace_subscriptions: 'subscription',
  advertising: 'promotion',
  warehouse: 'storage',
};

/** 10 млрд ₽ в копейках: больше — опечатка, а не расход; и далеко внутри 2^53 при × 31. */
export const MAX_EXPENSE_KOPECKS = 1_000_000_000_000;
export const MAX_EXPENSE_NOTE_LENGTH = 200;
export const MAX_EXPENSE_CATEGORY_NAME_LENGTH = 60;
export const MAX_EXPENSE_SOURCE_LENGTH = 200;
/** Номер заказа и артикул — с запасом над длиннейшими у ЯМ/Ozon/WB. */
export const MAX_EXPENSE_REF_LENGTH = 100;

/** Проверенный расход — то, что пишется в базу. */
export interface IExpenseValue {
  kind: TExpenseKind;
  category: string;
  amountKopecks: number;
  /** ГГГГ-ММ-ДД: у разовой — её день, у ежемесячной — начало. */
  fromDay: string;
  /** ГГГГ-ММ-ДД включительно; у ежемесячной null — без конца, у периода обязателен. */
  toDay: string | null;
  note: string | null;
  /** Откуда расход: счёт, выписка, чек… Необязателен (решение `expenses_v2_source`). */
  source: string | null;
  /** null — `business` (записи до v2 и форма без привязки). */
  scope: TExpenseScope | null;
  marketplace: TFinanceMarketplace | null;
  orderId: string | null;
  sku: string | null;
}

export type TExpenseField =
  | 'kind'
  | 'category'
  | 'amount'
  | 'fromDay'
  | 'toDay'
  | 'note'
  | 'source'
  | 'scope'
  | 'marketplace'
  | 'orderId'
  | 'sku';

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
  if (kind !== 'one_off' && kind !== 'monthly' && kind !== 'period') {
    return fail('kind', 'Выберите вид расхода: разовый, ежемесячный или за период');
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
  if (kind === 'period' && !present(input.toDay)) {
    return fail('toDay', 'Укажите конец периода');
  }
  if (kind !== 'one_off' && present(input.toDay)) {
    if (!isIsoDay(input.toDay)) return fail('toDay', 'Дата окончания указана неверно');
    if (input.toDay < fromDay) return fail('toDay', 'Окончание раньше начала');
    toDay = input.toDay;
  }

  const note = optionalText(input.note, MAX_EXPENSE_NOTE_LENGTH, 'Комментарий');
  if (note.ok === false) return fail('note', note.error);
  const source = optionalText(input.source, MAX_EXPENSE_SOURCE_LENGTH, 'Источник');
  if (source.ok === false) return fail('source', source.error);

  const binding = bindingOf(input);
  if (binding.ok === false) return fail(binding.field, binding.error);

  return {
    ok: true,
    value: {
      kind,
      category,
      amountKopecks,
      fromDay,
      toDay,
      note: note.value,
      source: source.value,
      ...binding.value,
    },
  };
}

const present = (value: unknown) => value !== undefined && value !== null && value !== '';

type TTextResult = { ok: true; value: string | null } | { ok: false; error: string };

function optionalText(value: unknown, max: number, title: string): TTextResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${title} — текст` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false, error: `${title} длиннее ${max} символов` };
  return { ok: true, value: trimmed || null };
}

type TBinding = Pick<IExpenseValue, 'scope' | 'marketplace' | 'orderId' | 'sku'>;
type TBindingResult =
  | { ok: true; value: TBinding }
  | { ok: false; field: TExpenseField; error: string };

/**
 * Привязка расхода. Нет `scope` — прежний ввод (весь бизнес), остальные поля
 * не читаются. Поле, лишнее для выбранной привязки, отбрасывается, а не
 * хранится молча: расход «на бизнес» с артикулом читался бы как расход товара.
 */
function bindingOf(input: Record<string, unknown>): TBindingResult {
  const none: TBinding = { scope: null, marketplace: null, orderId: null, sku: null };
  if (!present(input.scope)) return { ok: true, value: none };
  const scope = input.scope;
  if (!isExpenseScope(scope)) {
    return { ok: false, field: 'scope', error: 'Выберите, к чему относится расход' };
  }
  if (scope === 'business') return { ok: true, value: { ...none, scope } };

  let marketplace: TFinanceMarketplace | null = null;
  if (present(input.marketplace)) {
    if (!isMarketplace(input.marketplace)) {
      return { ok: false, field: 'marketplace', error: 'Выберите площадку из списка' };
    }
    marketplace = input.marketplace;
  }
  if (!marketplace && scope !== 'product') {
    return { ok: false, field: 'marketplace', error: 'Выберите площадку' };
  }
  if (scope === 'marketplace') return { ok: true, value: { ...none, scope, marketplace } };

  const field = scope === 'order' ? 'orderId' : 'sku';
  const ref = optionalText(input[field], MAX_EXPENSE_REF_LENGTH, 'Значение');
  if (ref.ok === false) return { ok: false, field, error: ref.error };
  if (!ref.value) {
    return {
      ok: false,
      field,
      error: scope === 'order' ? 'Укажите номер заказа' : 'Укажите артикул товара',
    };
  }
  return scope === 'order'
    ? { ok: true, value: { ...none, scope, marketplace, orderId: ref.value } }
    : { ok: true, value: { ...none, scope, marketplace, sku: ref.value } };
}

// ── Двойной учёт с реестром (TASK-220) ─────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return `${day.slice(0, 7)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/**
 * Окно, за которое ищется то же начисление площадки, — целые месяцы признания:
 * подписка и хранение начисляются раз в месяц в свой день, разовый расход
 * 05.10 и начисление 31.10 — один и тот же месяц. Ежемесячный без конца —
 * до месяца `today`, но не раньше начала.
 */
export function expenseRecognitionWindow(
  expense: Pick<IExpenseValue, 'kind' | 'fromDay' | 'toDay'>,
  today: string,
): { from: string; to: string } {
  let last = expense.fromDay;
  if (expense.kind !== 'one_off') {
    last = expense.toDay ?? (today > expense.fromDay ? today : expense.fromDay);
  }
  return { from: monthStart(expense.fromDay), to: monthEnd(last) };
}

/** Начисление реестра для проверки: статья, площадка, день начисления. */
export interface IRegistryAccrual {
  article: TFinanceArticle;
  marketplace: TFinanceMarketplace;
  /** ГГГГ-ММ-ДД (Москва). */
  accruedOn: string;
}

/**
 * Статья реестра, которую расход повторяет, или null. Площадка задана — только
 * её начисления; не задана — любой площадки. Привязка к заказу/товару не
 * сужает: подписку площадки не начисляют на заказ.
 */
export function doubleCountArticleOf(
  expense: Pick<IExpenseValue, 'kind' | 'category' | 'fromDay' | 'toDay' | 'marketplace'>,
  accruals: readonly IRegistryAccrual[],
  today: string,
): TFinanceArticle | null {
  const article = isPresetCategory(expense.category)
    ? EXPENSE_REGISTRY_ARTICLE[expense.category]
    : undefined;
  if (!article) return null;
  const window = expenseRecognitionWindow(expense, today);
  const found = accruals.some(
    (a) =>
      a.article === article &&
      (!expense.marketplace || a.marketplace === expense.marketplace) &&
      a.accruedOn >= window.from &&
      a.accruedOn <= window.to,
  );
  return found ? article : null;
}

/** Текст предупреждения о двойном учёте — один на ответ сохранения и на экран. */
export function doubleCountWarningOf(article: TFinanceArticle | null): string | null {
  if (!article) return null;
  return (
    `Площадка уже начисляет «${FINANCE_ARTICLE_META[article].title}» за этот период — ` +
    'расход может быть учтён дважды'
  );
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
