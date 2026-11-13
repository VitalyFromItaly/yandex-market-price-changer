/**
 * Ручная операция реестра «Финучёта» (ТЗ п.1, TASK-208): начисление, которого нет
 * ни в API, ни в файлах площадки, — продавец вносит его сам, с источником.
 *
 * Хранится в своей таблице `accounting_manual_operations`, а не в
 * `finance_operations` (решение `accounting_manual_ops_own_table`): ни один
 * читатель текущего механизма её не видит, и загрузка из API не может её
 * «заменить». Контракт полей — тот же, что у строки журнала: площадка, статья,
 * подстатья, сумма со знаком в копейках, день, заказ/SKU.
 *
 * Лист: чистые функции, импорты — листы.
 */

import type { TAccountingSubArticle } from './accounting-sub-articles';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TFinanceArticle } from '../finance/finance-articles';

import { FINANCE_MARKETPLACES } from '../../database/postgres/finance.schema';
import { isIsoDay, isUuid } from '../finance/expense.domain';
import { FINANCE_ARTICLE_META, isFinanceArticle } from '../finance/finance-articles';
import { toKopecks } from '../finance/kopecks';

import { isAccountingSubArticle } from './accounting-sub-articles';

/** Потолок суммы: 1 млрд ₽ — ввод с лишними нулями, а не операция. */
export const MAX_MANUAL_OPERATION_KOPECKS = 100_000_000_000;
export const MAX_SOURCE_LENGTH = 200;
export const MAX_DOCUMENT_NUMBER_LENGTH = 100;
export const MAX_REF_LENGTH = 100;
export const MAX_NOTE_LENGTH = 500;

/** Проверенное значение формы — то, что пишется в таблицу. */
export interface IManualOperationValue {
  marketplace: TFinanceMarketplace;
  article: TFinanceArticle;
  subArticle: TAccountingSubArticle | null;
  /** Со знаком: «+» — деньги продавцу, «−» — удержание. Не ноль. */
  amountKopecks: number;
  /** ГГГГ-ММ-ДД — день начисления. */
  accruedOn: string;
  orderId: string | null;
  sku: string | null;
  /** Откуда взята операция: письмо поддержки, акт сверки, выписка… Обязателен. */
  source: string;
  documentNumber: string | null;
  note: string | null;
}

export type TManualOperationField =
  | 'clientKey'
  | 'marketplace'
  | 'article'
  | 'subArticle'
  | 'amount'
  | 'accruedOn'
  | 'orderId'
  | 'sku'
  | 'source'
  | 'documentNumber'
  | 'note';

export type TManualOperationValidation =
  | { ok: true; value: IManualOperationValue }
  | { ok: false; field: TManualOperationField; error: string };

const fail = (field: TManualOperationField, error: string): TManualOperationValidation => ({
  ok: false,
  field,
  error,
});

/**
 * Необязательный текст: пусто — null; не строка или длиннее потолка — `error`.
 * Не union по `ok`: без strictNullChecks он не сужается.
 */
function optionalText(value: unknown, max: number): { value: string | null; error: string | null } {
  if (value === undefined || value === null) return { value: null, error: null };
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { value: null, error: 'Ожидается текст' };
  }
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (text.length > max) return { value: null, error: `Не длиннее ${max} символов` };
  return { value: text || null, error: null };
}

/**
 * Статьи, которые можно внести руками: все, кроме «Не распознано» и рекламы по
 * отчёту «Продвижение» — её строки только из файла кабинета (TASK-209).
 */
export function isManualArticle(value: unknown): value is TFinanceArticle {
  return isFinanceArticle(value) && value !== 'unknown' && value !== 'promotion_report';
}

/**
 * Ввод формы → проверенное значение или первая ошибка с полем. Сумма — рубли
 * числом или строкой со знаком («−1 500,50»), разбирает `toKopecks` журнала:
 * одно правило копеек на весь финмодуль, дробных копеек не бывает.
 */
export function validateManualOperationInput(
  input: Record<string, unknown>,
): TManualOperationValidation {
  const marketplace = input.marketplace;
  if (
    typeof marketplace !== 'string' ||
    !(FINANCE_MARKETPLACES as readonly string[]).includes(marketplace)
  ) {
    return fail('marketplace', 'Выберите площадку');
  }

  const article = input.article;
  if (!isManualArticle(article)) return fail('article', 'Выберите статью из списка');

  let subArticle: TAccountingSubArticle | null = null;
  if (input.subArticle !== undefined && input.subArticle !== null && input.subArticle !== '') {
    if (!isAccountingSubArticle(input.subArticle) || input.subArticle === 'unknown') {
      return fail('subArticle', 'Выберите подстатью из списка');
    }
    subArticle = input.subArticle;
  }

  const raw = typeof input.amount === 'string' ? input.amount.replace(/[−–]/g, '-') : input.amount;
  const amountKopecks = toKopecks(raw);
  if (amountKopecks === null) {
    return fail('amount', 'Сумма — число в рублях со знаком, например −1500 или 300,50');
  }
  if (amountKopecks === 0) return fail('amount', 'Сумма не может быть нулевой');
  if (Math.abs(amountKopecks) > MAX_MANUAL_OPERATION_KOPECKS) {
    return fail('amount', 'Слишком большая сумма');
  }

  if (!isIsoDay(input.accruedOn)) return fail('accruedOn', 'Укажите дату начисления');
  const accruedOn = input.accruedOn;

  const orderId = optionalText(input.orderId, MAX_REF_LENGTH);
  if (orderId.error) return fail('orderId', orderId.error);
  const sku = optionalText(input.sku, MAX_REF_LENGTH);
  if (sku.error) return fail('sku', sku.error);

  const source = optionalText(input.source, MAX_SOURCE_LENGTH);
  if (source.error) return fail('source', source.error);
  if (!source.value) return fail('source', 'Укажите источник: откуда взята операция');

  const documentNumber = optionalText(input.documentNumber, MAX_DOCUMENT_NUMBER_LENGTH);
  if (documentNumber.error) return fail('documentNumber', documentNumber.error);
  const note = optionalText(input.note, MAX_NOTE_LENGTH);
  if (note.error) return fail('note', note.error);

  return {
    ok: true,
    value: {
      marketplace: marketplace as TFinanceMarketplace,
      article,
      subArticle,
      amountKopecks,
      accruedOn,
      orderId: orderId.value,
      sku: sku.value,
      source: source.value,
      documentNumber: documentNumber.value,
      note: note.value,
    },
  };
}

/**
 * Ключ формы — uuid, который форма заводит при открытии и шлёт с каждой
 * отправкой: повторная отправка той же формы (двойной клик, повтор после
 * обрыва сети) находит уже созданную операцию, а не заводит вторую.
 */
export function isClientKey(value: unknown): value is string {
  return isUuid(value);
}

/** Действие в журнале изменений операции. */
export type TManualOperationAction = 'create' | 'update' | 'delete';

export const MANUAL_OPERATION_ACTION_LABEL: Record<TManualOperationAction, string> = {
  create: 'Создана',
  update: 'Изменена',
  delete: 'Удалена',
};

/** Поля, которые сравнивает и хранит журнал «было/стало» — значение формы целиком. */
export const MANUAL_OPERATION_FIELDS: Record<keyof IManualOperationValue, string> = {
  marketplace: 'Площадка',
  article: 'Статья',
  subArticle: 'Подстатья',
  amountKopecks: 'Сумма',
  accruedOn: 'Дата',
  orderId: 'Заказ',
  sku: 'SKU',
  source: 'Источник',
  documentNumber: 'Номер документа',
  note: 'Комментарий',
};

/** Снимок значения для журнала — только поля формы, в постоянном порядке. */
export function manualSnapshot(value: IManualOperationValue): IManualOperationValue {
  const snapshot = {} as Record<keyof IManualOperationValue, unknown>;
  for (const key of Object.keys(MANUAL_OPERATION_FIELDS) as (keyof IManualOperationValue)[]) {
    snapshot[key] = value[key];
  }
  return snapshot as unknown as IManualOperationValue;
}

/** Какие поля изменились; пусто — правка ничего не меняет и в журнал не идёт. */
export function changedFields(
  before: IManualOperationValue,
  after: IManualOperationValue,
): (keyof IManualOperationValue)[] {
  return (Object.keys(MANUAL_OPERATION_FIELDS) as (keyof IManualOperationValue)[]).filter(
    (key) => before[key] !== after[key],
  );
}

/** Подпись статьи для экрана. */
export const manualArticleTitle = (article: TFinanceArticle) => FINANCE_ARTICLE_META[article].title;
