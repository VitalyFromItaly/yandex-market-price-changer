import type { PriceSetApplyRequest, PriceSetMarketplace } from '../price-set.domain';
import type { JobStartResponse } from '@/shared/jobs';

import { http } from '@/shared/http';

const BASE = '/ym/price-set';

/** План по наценке — обычная задача `POST /jobs` (общий useJob.start), отдельного метода нет. */
export const priceSetApi = {
  /** multipart: файл цен и площадки (`ym,wb`) — план по файлу, фоновая задача по jobId. */
  upload: async (
    file: File,
    marketplaces: readonly PriceSetMarketplace[],
  ): Promise<JobStartResponse> => {
    const form = new FormData();
    form.append('marketplaces', marketplaces.join(','));
    form.append('file', file, file.name);
    return await http.upload<JobStartResponse>(`${BASE}/upload`, form);
  },

  /** Запись подтверждённого плана без снятых строк — фоновая задача по jobId. */
  apply: async (request: PriceSetApplyRequest): Promise<{ jobId: string }> =>
    await http.post<{ jobId: string }>(`${BASE}/apply`, request),
};
