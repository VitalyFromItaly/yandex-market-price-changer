/**
 * Раздел «Закупки» (TASK-122): закупки партий и уплаченные налоги. Закупка —
 * движение денег, на чистую прибыль она не влияет; ДДС, выплаты и деньги к
 * получению — в «Финансах» (TASK-124). Все числа считает сервер; фронт
 * только показывает.
 */

export interface PurchaseLine {
  sku: string;
  name: string | null;
  count: number;
  priceKopecks: number;
}

export interface Purchase {
  id: string;
  supplier: string;
  /** ГГГГ-ММ-ДД — день оплаты. */
  paidDay: string;
  amountKopecks: number;
  lines: PurchaseLine[] | null;
  note: string | null;
}

export interface TaxPayment {
  id: string;
  paidDay: string;
  amountKopecks: number;
  note: string | null;
}

export interface PurchasesView {
  purchases: Purchase[];
  taxPayments: TaxPayment[];
  limits: { supplierMaxLength: number; noteMaxLength: number; linesMax: number };
}

/** Ответ API совпадает с видом: сервер уже перечисляет поля сам. */
export type PurchasesResponse = PurchasesView;

/** Строки ввода позиции; разбирает сервер. */
export interface PurchaseLineForm {
  sku: string;
  name: string;
  count: string;
  price: string;
}

export interface PurchaseForm {
  supplier: string;
  paidDay: string;
  amount: string;
  note: string;
  lines: PurchaseLineForm[];
}

export interface PurchaseBody {
  supplier: string;
  paidDay: string;
  amount: string;
  note: string | null;
  lines: { sku: string; name: string | null; count: string; price: string }[] | null;
}

export interface TaxPaymentForm {
  paidDay: string;
  amount: string;
  note: string;
}

export interface TaxPaymentBody {
  paidDay: string;
  amount: string;
  note: string | null;
}

export type PurchaseField = 'supplier' | 'paidDay' | 'amount' | 'lines' | 'note';

/** Ошибка под полем формы; `form` — общая, без поля. */
export type PurchaseErrors = Partial<Record<PurchaseField | 'form', string>>;

export interface PurchaseRow {
  id: string;
  supplier: string;
  day: string;
  amount: string;
  /** «3 позиции» / null. */
  linesLabel: string | null;
  note: string | null;
}

export interface TaxPaymentRow {
  id: string;
  day: string;
  amount: string;
  note: string | null;
}

export const PURCHASE_ERROR_CODE = {
  INVALID_PURCHASE: 'INVALID_PURCHASE',
  PURCHASE_NOT_FOUND: 'PURCHASE_NOT_FOUND',
} as const;
