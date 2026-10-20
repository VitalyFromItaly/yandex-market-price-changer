/**
 * Закупки партий и уплаченные налоги (TASK-122, ТЗ п.3): проверка ввода.
 * Чистые функции — без Nest и базы.
 *
 * Закупка — движение денег, а не расход P&L: себестоимость проданного P&L уже
 * берёт по продажам (`datedCosts`), и закупка партии там списала бы тот же
 * товар второй раз. Поэтому ни позиции, ни сумма закупки на прибыль не влияют —
 * они живут только в ДДС (`cashflow.ts`).
 */

import { isIsoDay, MAX_EXPENSE_KOPECKS } from './expense.domain';
import { toKopecks } from './kopecks';

export const MAX_PURCHASE_KOPECKS = MAX_EXPENSE_KOPECKS;
export const MAX_SUPPLIER_LENGTH = 120;
export const MAX_PURCHASE_NOTE_LENGTH = 200;
export const MAX_PURCHASE_LINES = 200;
export const MAX_LINE_SKU_LENGTH = 255;
export const MAX_LINE_NAME_LENGTH = 200;
export const MAX_LINE_COUNT = 1_000_000;

/**
 * Позиция партии — справка (решение `purchase_lines_optional`): что пришло и
 * почём. На себестоимость не влияет: закуп товара — прайс и CostHistory.
 */
export interface IPurchaseLine {
  sku: string;
  name: string | null;
  count: number;
  priceKopecks: number;
}

/** Проверенная закупка — то, что пишется в базу. */
export interface IPurchaseValue {
  supplier: string;
  /** ГГГГ-ММ-ДД — день оплаты: по нему закупка ложится в ДДС. */
  paidDay: string;
  amountKopecks: number;
  /** null — позиции не указаны. */
  lines: IPurchaseLine[] | null;
  note: string | null;
}

/** Уплата налога (решение `cashflow_tax_paid_manual`). */
export interface ITaxPaymentValue {
  paidDay: string;
  amountKopecks: number;
  note: string | null;
}

export type TPurchaseField = 'supplier' | 'paidDay' | 'amount' | 'lines' | 'note';

type TValidation<V> = { ok: true; value: V } | { ok: false; field: TPurchaseField; error: string };

const fail = <V>(field: TPurchaseField, error: string): TValidation<V> => ({
  ok: false,
  field,
  error,
});

function amountOf(raw: unknown): { ok: true; kopecks: number } | { ok: false; error: string } {
  const kopecks = toKopecks(raw);
  if (kopecks === null) return { ok: false, error: 'Сумма — число в рублях, например 150000' };
  if (kopecks <= 0) return { ok: false, error: 'Сумма должна быть больше нуля' };
  if (kopecks > MAX_PURCHASE_KOPECKS) return { ok: false, error: 'Слишком большая сумма' };
  return { ok: true, kopecks };
}

function noteOf(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Комментарий — текст' };
  const trimmed = raw.trim();
  if (trimmed.length > MAX_PURCHASE_NOTE_LENGTH) {
    return { ok: false, error: `Комментарий длиннее ${MAX_PURCHASE_NOTE_LENGTH} символов` };
  }
  return { ok: true, note: trimmed || null };
}

/**
 * Позиции: пусто/не задано → null. Каждая — артикул, штуки (целое > 0) и цена
 * за штуку. Ошибка позиции пишется в поле `lines` с её номером.
 */
function linesOf(
  raw: unknown,
): { ok: true; lines: IPurchaseLine[] | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, lines: null };
  if (!Array.isArray(raw)) return { ok: false, error: 'Позиции — список' };
  if (!raw.length) return { ok: true, lines: null };
  if (raw.length > MAX_PURCHASE_LINES) {
    return { ok: false, error: `Позиций больше ${MAX_PURCHASE_LINES}` };
  }
  const lines: IPurchaseLine[] = [];
  for (const [index, item] of raw.entries()) {
    const no = `Позиция ${index + 1}`;
    if (!item || typeof item !== 'object') return { ok: false, error: `${no}: заполните строку` };
    const line = item as Record<string, unknown>;
    const sku = typeof line.sku === 'string' ? line.sku.trim() : '';
    if (!sku) return { ok: false, error: `${no}: укажите артикул` };
    if (sku.length > MAX_LINE_SKU_LENGTH)
      return { ok: false, error: `${no}: артикул слишком длинный` };
    let name: string | null = null;
    if (line.name !== undefined && line.name !== null) {
      if (typeof line.name !== 'string') return { ok: false, error: `${no}: название — текст` };
      name = line.name.trim().slice(0, MAX_LINE_NAME_LENGTH) || null;
    }
    const count = typeof line.count === 'string' ? Number(line.count.trim()) : line.count;
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count <= 0 ||
      count > MAX_LINE_COUNT
    ) {
      return { ok: false, error: `${no}: штуки — целое число больше нуля` };
    }
    const priceKopecks = toKopecks(line.price);
    if (priceKopecks === null || priceKopecks <= 0 || priceKopecks > MAX_PURCHASE_KOPECKS) {
      return { ok: false, error: `${no}: цена — число в рублях больше нуля` };
    }
    lines.push({ sku, name, count, priceKopecks });
  }
  return { ok: true, lines };
}

/** Σ штуки × цена позиций, копейки. */
export function linesTotalKopecks(lines: readonly IPurchaseLine[]): number {
  return lines.reduce((sum, line) => sum + line.count * line.priceKopecks, 0);
}

/**
 * Ввод закупки → проверенное значение или первая ошибка с полем. Если позиции
 * заданы, их Σ обязана равняться сумме: две суммы одной партии, которые не
 * сходятся, — это опечатка, и какой верить, решать не нам.
 */
export function validatePurchaseInput(input: Record<string, unknown>): TValidation<IPurchaseValue> {
  const supplier =
    typeof input.supplier === 'string' ? input.supplier.trim().replace(/\s+/g, ' ') : '';
  if (!supplier) return fail('supplier', 'Укажите поставщика');
  if (supplier.length > MAX_SUPPLIER_LENGTH) {
    return fail('supplier', `Поставщик длиннее ${MAX_SUPPLIER_LENGTH} символов`);
  }

  const paidDay = input.paidDay;
  if (!isIsoDay(paidDay)) return fail('paidDay', 'Укажите дату оплаты');

  const amount = amountOf(input.amount);
  if (amount.ok === false) return fail('amount', amount.error);

  const lines = linesOf(input.lines);
  if (lines.ok === false) return fail('lines', lines.error);
  if (lines.lines && linesTotalKopecks(lines.lines) !== amount.kopecks) {
    return fail('lines', 'Сумма позиций не равна сумме закупки');
  }

  const note = noteOf(input.note);
  if (note.ok === false) return fail('note', note.error);

  return {
    ok: true,
    value: {
      supplier,
      paidDay,
      amountKopecks: amount.kopecks,
      lines: lines.lines,
      note: note.note,
    },
  };
}

export function validateTaxPaymentInput(
  input: Record<string, unknown>,
): TValidation<ITaxPaymentValue> {
  const paidDay = input.paidDay;
  if (!isIsoDay(paidDay)) return fail('paidDay', 'Укажите дату уплаты');
  const amount = amountOf(input.amount);
  if (amount.ok === false) return fail('amount', amount.error);
  const note = noteOf(input.note);
  if (note.ok === false) return fail('note', note.error);
  return { ok: true, value: { paidDay, amountKopecks: amount.kopecks, note: note.note } };
}
