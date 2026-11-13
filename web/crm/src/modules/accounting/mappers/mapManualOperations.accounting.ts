import type {
  ManualOperation,
  ManualOperationBody,
  ManualOperationErrors,
  ManualOperationField,
  ManualOperationForm,
  ManualOperationRow,
} from '../accounting.domain';

import { MANUAL_OPERATION_ERROR_CODE } from '../accounting.domain';

import { ApiError } from '@/shared/http';
import { formatDay, formatKopecks } from '@/shared/utils';

const FIELDS: readonly ManualOperationField[] = [
  'marketplace',
  'article',
  'subArticle',
  'amount',
  'accruedOn',
  'orderId',
  'sku',
  'source',
  'documentNumber',
  'note',
];

/** Копейки → строка поля со знаком: «-1500,5». */
function amountInput(kopecks: number): string {
  return String(kopecks / 100).replace('.', ',');
}

/** Форма новой операции или правки существующей. */
export function toManualForm(
  operation: ManualOperation | null,
  today: string,
): ManualOperationForm {
  if (operation === null) {
    return {
      marketplace: 'ym',
      article: 'compensations',
      subArticle: '',
      amount: '',
      accruedOn: today,
      orderId: '',
      sku: '',
      source: '',
      documentNumber: '',
      note: '',
    };
  }
  return {
    marketplace: operation.marketplace,
    article: operation.article,
    subArticle: operation.subArticle ?? '',
    amount: amountInput(operation.amountKopecks),
    accruedOn: operation.accruedOn,
    orderId: operation.orderId ?? '',
    sku: operation.sku ?? '',
    source: operation.source,
    documentNumber: operation.documentNumber ?? '',
    note: operation.note ?? '',
  };
}

const orNull = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export function manualBody(form: ManualOperationForm, clientKey?: string): ManualOperationBody {
  return {
    ...(clientKey ? { clientKey } : {}),
    marketplace: form.marketplace,
    article: form.article,
    subArticle: orNull(form.subArticle),
    amount: form.amount.trim(),
    accruedOn: form.accruedOn,
    orderId: orNull(form.orderId),
    sku: orNull(form.sku),
    source: form.source.trim(),
    documentNumber: orNull(form.documentNumber),
    note: orNull(form.note),
  };
}

/** Ошибка сервера → под своё поле; без поля — общей строкой формы. */
export function mapManualError(error: unknown, fallback: string): ManualOperationErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === MANUAL_OPERATION_ERROR_CODE.INVALID &&
    error.field !== null &&
    (FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}

export function toManualRow(operation: ManualOperation): ManualOperationRow {
  const ref = [
    operation.orderId && `заказ ${operation.orderId}`,
    operation.sku && `SKU ${operation.sku}`,
  ]
    .filter(Boolean)
    .join(', ');
  const doc = operation.documentNumber ? ` · № ${operation.documentNumber}` : '';
  return {
    id: operation.id,
    dayLabel: formatDay(operation.accruedOn),
    marketplaceLabel: operation.marketplaceLabel,
    articleLabel: operation.subArticleLabel
      ? `${operation.articleLabel} · ${operation.subArticleLabel}`
      : operation.articleLabel,
    amountLabel: `${operation.amountKopecks > 0 ? '+' : ''}${formatKopecks(operation.amountKopecks)}`,
    income: operation.amountKopecks > 0,
    refLabel: ref || null,
    sourceLabel: `${operation.source}${doc}`,
  };
}

/** Ключ формы — uuid; нет crypto.randomUUID (старый браузер) — из случайных байт. */
export function newClientKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
