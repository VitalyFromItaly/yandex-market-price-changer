import type {
  TaxBody,
  TaxesResponse,
  TaxesView,
  TaxReconciliationBody,
  TaxReductionBody,
  TaxReductionsView,
  TaxYearPeriodKey,
} from '../taxes.domain';

import { http } from '@/shared/http';

const BASE = '/ym/taxes';

/** Запись отвечает полным видом: форма пересобирается из того, что сохранено. */
export const taxesApi = {
  get: (): Promise<TaxesView> => http.get<TaxesResponse>(BASE),

  save: (body: TaxBody): Promise<TaxesView> => http.put<TaxesResponse>(BASE, body),

  /* Вкладка «Год» (TASK-146): расчёт года — фоновая задача `taxes:year`. */

  setStaff: (hasStaff: boolean): Promise<{ hasStaff: boolean }> =>
    http.put<{ hasStaff: boolean }>(`${BASE}/staff`, { hasStaff }),

  reductions: (): Promise<TaxReductionsView> => http.get<TaxReductionsView>(`${BASE}/reductions`),

  createReduction: (body: TaxReductionBody): Promise<TaxReductionsView> =>
    http.post<TaxReductionsView>(`${BASE}/reductions`, body),

  updateReduction: (id: string, body: TaxReductionBody): Promise<TaxReductionsView> =>
    http.put<TaxReductionsView>(`${BASE}/reductions/${encodeURIComponent(id)}`, body),

  removeReduction: (id: string): Promise<TaxReductionsView> =>
    http.delete<TaxReductionsView>(`${BASE}/reductions/${encodeURIComponent(id)}`),

  reconcile: (
    year: number,
    period: TaxYearPeriodKey,
    body: TaxReconciliationBody,
  ): Promise<{ ok: true }> =>
    http.put<{ ok: true }>(`${BASE}/reconciliations/${year}/${period}`, body),
};
