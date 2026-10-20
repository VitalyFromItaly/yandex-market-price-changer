import type {
  Purchase,
  PurchaseBody,
  PurchaseErrors,
  PurchaseField,
  PurchaseForm,
  PurchaseLineForm,
  PurchaseRow,
  TaxPayment,
  TaxPaymentBody,
  TaxPaymentForm,
  TaxPaymentRow,
} from '../purchases.domain';

import { PURCHASE_ERROR_CODE } from '../purchases.domain';

import { ApiError } from '@/shared/http';
import { formatDay, formatRub } from '@/shared/utils';

const FIELDS: readonly PurchaseField[] = ['supplier', 'paidDay', 'amount', 'lines', 'note'];

export function kopecksToRubText(kopecks: number): string {
  return formatRub(kopecks / 100);
}

/** Копейки → строка поля: «30000», «1250,5» — без пробелов, которые набирать неудобно. */
function amountInput(kopecks: number): string {
  return String(kopecks / 100).replace('.', ',');
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function toPurchaseRow(purchase: Purchase): PurchaseRow {
  const count = purchase.lines?.length ?? 0;
  return {
    id: purchase.id,
    supplier: purchase.supplier,
    day: formatDay(purchase.paidDay),
    amount: kopecksToRubText(purchase.amountKopecks),
    linesLabel: count ? `${count} ${plural(count, ['позиция', 'позиции', 'позиций'])}` : null,
    note: purchase.note,
  };
}

export function toTaxPaymentRow(payment: TaxPayment): TaxPaymentRow {
  return {
    id: payment.id,
    day: formatDay(payment.paidDay),
    amount: kopecksToRubText(payment.amountKopecks),
    note: payment.note,
  };
}

export const emptyLine = (): PurchaseLineForm => ({ sku: '', name: '', count: '1', price: '' });

/** Форма новой закупки или правки существующей. */
export function toPurchaseForm(purchase: Purchase | null, today: string): PurchaseForm {
  if (purchase === null) return { supplier: '', paidDay: today, amount: '', note: '', lines: [] };
  return {
    supplier: purchase.supplier,
    paidDay: purchase.paidDay,
    amount: amountInput(purchase.amountKopecks),
    note: purchase.note ?? '',
    lines: (purchase.lines ?? []).map((line) => ({
      sku: line.sku,
      name: line.name ?? '',
      count: String(line.count),
      price: amountInput(line.priceKopecks),
    })),
  };
}

/** Пустые строки позиций (ни артикула, ни цены) не отправляются: их просто не дописали. */
export function purchaseBody(form: PurchaseForm): PurchaseBody {
  const note = form.note.trim();
  const lines = form.lines
    .filter((line) => line.sku.trim() !== '' || line.price.trim() !== '')
    .map((line) => ({
      sku: line.sku.trim(),
      name: line.name.trim() === '' ? null : line.name.trim(),
      count: line.count.trim(),
      price: line.price.trim(),
    }));
  return {
    supplier: form.supplier.trim(),
    paidDay: form.paidDay,
    amount: form.amount.trim(),
    note: note === '' ? null : note,
    lines: lines.length ? lines : null,
  };
}

const parseRub = (value: string): number | null => {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
};

/**
 * Σ позиций в рублях для подсказки под таблицей, пока продавец набирает.
 * Только подсказка — проверяет равенство сервер; неразобранная строка → null.
 */
export function linesTotalText(lines: readonly PurchaseLineForm[]): string | null {
  let kopecks = 0;
  let any = false;
  for (const line of lines) {
    if (line.price.trim() === '' && line.sku.trim() === '') continue;
    const price = parseRub(line.price);
    const count = Number(line.count.trim());
    if (price === null || !Number.isInteger(count) || count <= 0) return null;
    kopecks += price * count;
    any = true;
  }
  return any ? kopecksToRubText(kopecks) : null;
}

export function toTaxPaymentForm(payment: TaxPayment | null, today: string): TaxPaymentForm {
  if (payment === null) return { paidDay: today, amount: '', note: '' };
  return {
    paidDay: payment.paidDay,
    amount: amountInput(payment.amountKopecks),
    note: payment.note ?? '',
  };
}

export function taxPaymentBody(form: TaxPaymentForm): TaxPaymentBody {
  const note = form.note.trim();
  return { paidDay: form.paidDay, amount: form.amount.trim(), note: note === '' ? null : note };
}

/** Ошибка сервера → под своё поле; без поля — общей строкой формы. */
export function mapPurchaseError(error: unknown, fallback: string): PurchaseErrors {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof ApiError &&
    error.code === PURCHASE_ERROR_CODE.INVALID_PURCHASE &&
    error.field !== null &&
    (FIELDS as readonly string[]).includes(error.field)
  ) {
    return { [error.field]: message };
  }
  return { form: message };
}
