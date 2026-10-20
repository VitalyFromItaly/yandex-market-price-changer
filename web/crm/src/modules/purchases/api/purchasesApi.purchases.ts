import type {
  PurchaseBody,
  PurchasesResponse,
  PurchasesView,
  TaxPaymentBody,
} from '../purchases.domain';

import { http } from '@/shared/http';

const BASE = '/ym/purchases';
const id = (value: string) => encodeURIComponent(value);

/** Каждая запись отвечает полным видом раздела: таблица рисуется с сервера, не с формы. */
export const purchasesApi = {
  get: (): Promise<PurchasesView> => http.get<PurchasesResponse>(BASE),

  create: (body: PurchaseBody): Promise<PurchasesView> => http.post<PurchasesResponse>(BASE, body),

  update: (purchaseId: string, body: PurchaseBody): Promise<PurchasesView> =>
    http.put<PurchasesResponse>(`${BASE}/${id(purchaseId)}`, body),

  remove: (purchaseId: string): Promise<PurchasesView> =>
    http.delete<PurchasesResponse>(`${BASE}/${id(purchaseId)}`),

  createTax: (body: TaxPaymentBody): Promise<PurchasesView> =>
    http.post<PurchasesResponse>(`${BASE}/tax-payments`, body),

  updateTax: (paymentId: string, body: TaxPaymentBody): Promise<PurchasesView> =>
    http.put<PurchasesResponse>(`${BASE}/tax-payments/${id(paymentId)}`, body),

  removeTax: (paymentId: string): Promise<PurchasesView> =>
    http.delete<PurchasesResponse>(`${BASE}/tax-payments/${id(paymentId)}`),
};
