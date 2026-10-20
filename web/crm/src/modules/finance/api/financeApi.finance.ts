import type {
  Cashflow,
  FinanceAnomalies,
  FinanceCorrection,
  FinanceUploadResponse,
  FinanceDiscrepancy,
  FinanceMonth,
  FinancePage,
} from '../finance.domain';

import { http } from '@/shared/http';

const BASE = '/ym/finance';
const q = (value: string | number) => encodeURIComponent(String(value));

/** P&L месяца — фоновая задача `finance:pnl` (см. usePnl); здесь — быстрые запросы раздела. */
export const financeApi = {
  months: async (): Promise<FinanceMonth[]> =>
    (await http.get<{ months: FinanceMonth[] }>(`${BASE}/months`)).months,

  cashflow: (month: string): Promise<Cashflow> =>
    http.get<Cashflow>(`${BASE}/cashflow?month=${q(month)}`),

  discrepancies: (month: string, skip: number, limit: number) =>
    http.get<FinancePage<FinanceDiscrepancy>>(
      `${BASE}/discrepancies?month=${q(month)}&skip=${q(skip)}&limit=${q(limit)}`,
    ),

  anomalies: (month: string, skip: number, limit: number, unreviewedOnly: boolean) =>
    http.get<FinanceAnomalies>(
      `${BASE}/anomalies?month=${q(month)}&skip=${q(skip)}&limit=${q(limit)}` +
        (unreviewedOnly ? '&unreviewed=1' : ''),
    ),

  /** «Просмотрено» / «вернуть»; ответ — сколько ключей нашлось у продавца. */
  reviewAnomalies: (keys: readonly string[], reviewed: boolean) =>
    http.post<{ updated: number }>(`${BASE}/anomalies/review`, { keys, reviewed }),

  /** Отчёт по платежам файлом (TASK-114) — в журнал месяца `month`. */
  upload: (file: File, month: string): Promise<FinanceUploadResponse> => {
    const form = new FormData();
    form.append('month', month);
    form.append('file', file, file.name);
    return http.upload<FinanceUploadResponse>(`${BASE}/upload`, form);
  },

  corrections: (month: string, skip: number, limit: number) =>
    http.get<FinancePage<FinanceCorrection>>(
      `${BASE}/corrections?month=${q(month)}&skip=${q(skip)}&limit=${q(limit)}`,
    ),
};
