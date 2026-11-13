import type {
  CostChange,
  CostChangeRow,
  CostCorrectionBody,
  CostCorrectionErrors,
  CostCorrectionField,
  CostCorrectionForm,
  CostRecord,
  CostRecordRow,
  CostValue,
} from '../accounting.domain';

import { COST_CORRECTION_ERROR_CODE } from '../accounting.domain';

import { BASE_CURRENCY } from '@/modules/products/constants/purchase.products';
import {
  formatAuthor,
  formatPurchase,
  purchaseBody,
} from '@/modules/products/mappers/mapProducts.products';
import { ApiError } from '@/shared/http';
import { formatMoscowDate } from '@/shared/utils';

const FIELDS: readonly CostCorrectionField[] = [
  'validFrom',
  'price',
  'currency',
  'rate',
  'extraCosts',
  'reason',
];

/** Москва без перехода на летнее время с 2014 года: смещение постоянное. */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const MOSCOW_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
});

/** Момент ISO → значение `datetime-local` по Москве; битая строка — пусто. */
export function toMoscowInput(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  return new Date(time + MOSCOW_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Значение `datetime-local` (Москва) → ISO. Пустое или кривое уходит как есть:
 * проверяет сервер, ошибка встанет под поле «Действует с».
 */
export function fromMoscowInput(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(`${trimmed}:00+03:00`);
  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
}

/** «24-10-2026 14:32» по Москве — дата всегда, даже сегодняшняя: это история. */
export function formatMoment(iso: string): string {
  const date = formatMoscowDate(iso);
  return date === null ? '—' : `${date} ${MOSCOW_TIME.format(new Date(iso))}`;
}

const byTimeDesc =
  <T>(time: (item: T) => string) =>
  (a: T, b: T) =>
    new Date(time(b)).getTime() - new Date(time(a)).getTime();

const valueLabel = (value: CostValue) =>
  `с ${formatMoment(value.validFrom)} · ${formatPurchase(value.purchase)}`;

/** Записи — новые сверху: последняя и есть действующая сейчас. */
export function toCostRecordRows(records: CostRecord[], me: string | undefined): CostRecordRow[] {
  return [...records].sort(byTimeDesc((record) => record.validFrom)).map((record) => ({
    id: record.id,
    momentLabel: formatMoment(record.validFrom),
    purchaseLabel: formatPurchase(record.purchase),
    sourceLabel: record.sourceLabel,
    authorLabel: formatAuthor(record.author, me),
  }));
}

/** Журнал — свежие правки сверху; правка администратора за продавца подписана. */
export function toCostChangeRows(changes: CostChange[], me: string | undefined): CostChangeRow[] {
  return [...changes].sort(byTimeDesc((change) => change.createdAt)).map((change) => ({
    id: change.id,
    actionLabel: change.actionLabel,
    createdLabel: formatMoment(change.createdAt),
    beforeLabel: change.before ? valueLabel(change.before) : null,
    afterLabel: valueLabel(change.after),
    authorLabel:
      formatAuthor(change.author, me) +
      (change.impersonatedBy ? ' · администратор за продавца' : ''),
    reason: change.reason,
  }));
}

const text = (value: number | null) => (value === null ? '' : String(value).replace('.', ','));

/**
 * Форма исправления: из записи — её момент и закуп, причина пустая; без записи —
 * текущая минута по Москве (сервер не примет будущее) и пустой закуп в рублях.
 */
export function toCorrectionForm(record: CostRecord | null, now: Date): CostCorrectionForm {
  if (record === null) {
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
    return {
      validFrom: toMoscowInput(minute),
      exactValidFrom: null,
      price: '',
      currency: BASE_CURRENCY,
      rate: '',
      extraCosts: '',
      reason: '',
    };
  }
  const { purchase } = record;
  return {
    validFrom: toMoscowInput(record.validFrom),
    exactValidFrom: record.validFrom,
    price: text(purchase.price),
    currency: purchase.currency,
    rate: purchase.currency === BASE_CURRENCY ? '' : text(purchase.rate),
    extraCosts: text(purchase.extraCosts),
    reason: '',
  };
}

/** Тело запроса: момент поля не трогали — точный момент записи; закуп — как в «Товарах». */
export function correctionBody(form: CostCorrectionForm): CostCorrectionBody {
  const exact = form.exactValidFrom;
  const untouched = exact !== null && toMoscowInput(exact) === form.validFrom;
  return {
    validFrom: untouched ? exact : fromMoscowInput(form.validFrom),
    ...purchaseBody(form),
    reason: form.reason.trim(),
  };
}

/** Ошибка сервера → под своё поле; чужой товар и прочее — общей строкой формы. */
export function mapCostCorrectionError(error: unknown, fallback: string): CostCorrectionErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === COST_CORRECTION_ERROR_CODE.INVALID &&
    error.field !== null &&
    (FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}
