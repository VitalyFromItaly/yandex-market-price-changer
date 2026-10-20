import { http } from '@/shared/http';

export const stockPushApi = {
  /** Запись подтверждённого плана в ЯМ — фоновая задача по jobId. */
  apply: async (planHash: string): Promise<{ jobId: string }> =>
    await http.post<{ jobId: string }>('/ym/stock-push/apply', { planHash }),
};
