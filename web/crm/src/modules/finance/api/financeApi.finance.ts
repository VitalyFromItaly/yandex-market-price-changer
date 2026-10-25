import type {
  Cashflow,
  FinanceAnomalies,
  FinanceCorrection,
  FinanceUploadResponse,
  FinanceDiscrepancy,
  FinanceMarketplace,
  FinanceMonth,
  FinancePage,
  FinanceUnsupported,
} from '../finance.domain';

import { http } from '@/shared/http';

const BASE = '/ym/finance';
const q = (value: string | number) => encodeURIComponent(String(value));

/**
 * P&L месяца — фоновая задача `finance:pnl` (см. usePnl); здесь — быстрые запросы раздела.
 * Площадка экрана — `?marketplace=` (TASK-180), адрес остаётся `/ym/finance`.
 */
export const financeApi = {
  months: async (marketplace: FinanceMarketplace): Promise<FinanceMonth[]> =>
    (await http.get<{ months: FinanceMonth[] }>(`${BASE}/months?marketplace=${q(marketplace)}`))
      .months,

  cashflow: (marketplace: FinanceMarketplace, month: string) =>
    http.get<Cashflow | FinanceUnsupported>(
      `${BASE}/cashflow?month=${q(month)}&marketplace=${q(marketplace)}`,
    ),

  discrepancies: (marketplace: FinanceMarketplace, month: string, skip: number, limit: number) =>
    http.get<FinancePage<FinanceDiscrepancy> | FinanceUnsupported>(
      `${BASE}/discrepancies?month=${q(month)}&skip=${q(skip)}&limit=${q(limit)}` +
        `&marketplace=${q(marketplace)}`,
    ),

  anomalies: (
    marketplace: FinanceMarketplace,
    month: string,
    skip: number,
    limit: number,
    unreviewedOnly: boolean,
  ) =>
    http.get<FinanceAnomalies | FinanceUnsupported>(
      `${BASE}/anomalies?month=${q(month)}&skip=${q(skip)}&limit=${q(limit)}` +
        `&marketplace=${q(marketplace)}` +
        (unreviewedOnly ? '&unreviewed=1' : ''),
    ),

  /** «Просмотрено» / «вернуть»; ответ — сколько ключей нашлось у продавца. */
  reviewAnomalies: (marketplace: FinanceMarketplace, keys: readonly string[], reviewed: boolean) =>
    http.post<{ updated: number }>(`${BASE}/anomalies/review?marketplace=${q(marketplace)}`, {
      keys,
      reviewed,
    }),

  /** Отчёт по платежам файлом (TASK-114) — в журнал месяца `month`. */
  upload: (file: File, month: string): Promise<FinanceUploadResponse> => {
    const form = new FormData();
    form.append('month', month);
    form.append('file', file, file.name);
    return http.upload<FinanceUploadResponse>(`${BASE}/upload`, form);
  },

  corrections: (marketplace: FinanceMarketplace, month: string, skip: number, limit: number) =>
    http.get<FinancePage<FinanceCorrection>>(
      `${BASE}/corrections?month=${q(month)}&skip=${q(skip)}&limit=${q(limit)}` +
        `&marketplace=${q(marketplace)}`,
    ),
};
