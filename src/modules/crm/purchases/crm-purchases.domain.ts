import type {
  TFinancePurchaseRow,
  TFinanceTaxPaymentRow,
} from '../../../database/postgres/repositories/finance-purchase.repository';
import type { IPurchasesSnapshot } from '../../finance/finance-purchases.service';
import type { IPurchaseLine } from '../../finance/purchase.domain';

import {
  MAX_PURCHASE_LINES,
  MAX_PURCHASE_NOTE_LENGTH,
  MAX_SUPPLIER_LENGTH,
} from '../../finance/purchase.domain';

/**
 * Раздел «Закупки» CRM (TASK-122): вид для фронта. Правила ввода — в
 * purchase.domain.ts финмодуля; ДДС переехал в «Финансы» (TASK-124). Здесь только сборка
 * ответа перечислением полей (`telegramUserId` наружу не уходит).
 */

/** 400: ввод не принят; `field` — под каким полем показать ошибку. */
export const INVALID_PURCHASE = 'INVALID_PURCHASE';
/** 404: записи нет (или она чужая). */
export const PURCHASE_NOT_FOUND = 'PURCHASE_NOT_FOUND';

export interface ICrmPurchaseView {
  id: string;
  supplier: string;
  paidDay: string;
  amountKopecks: number;
  lines: IPurchaseLine[] | null;
  note: string | null;
}

export interface ICrmTaxPaymentView {
  id: string;
  paidDay: string;
  amountKopecks: number;
  note: string | null;
}

export interface ICrmPurchasesView {
  purchases: ICrmPurchaseView[];
  taxPayments: ICrmTaxPaymentView[];
  limits: { supplierMaxLength: number; noteMaxLength: number; linesMax: number };
}

export function toCrmPurchaseView(row: TFinancePurchaseRow): ICrmPurchaseView {
  return {
    id: row.id,
    supplier: row.supplier,
    paidDay: row.paidDay,
    amountKopecks: row.amountKopecks,
    lines: row.lines ?? null,
    note: row.note,
  };
}

export function toCrmTaxPaymentView(row: TFinanceTaxPaymentRow): ICrmTaxPaymentView {
  return { id: row.id, paidDay: row.paidDay, amountKopecks: row.amountKopecks, note: row.note };
}

export function toCrmPurchasesView(snapshot: IPurchasesSnapshot): ICrmPurchasesView {
  return {
    purchases: snapshot.purchases.map(toCrmPurchaseView),
    taxPayments: snapshot.taxPayments.map(toCrmTaxPaymentView),
    limits: {
      supplierMaxLength: MAX_SUPPLIER_LENGTH,
      noteMaxLength: MAX_PURCHASE_NOTE_LENGTH,
      linesMax: MAX_PURCHASE_LINES,
    },
  };
}
