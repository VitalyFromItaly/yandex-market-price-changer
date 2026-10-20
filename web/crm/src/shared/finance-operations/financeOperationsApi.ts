import type { FinanceOperation } from './financeOperations.domain';
import type { DownloadedFile } from '@/shared/http';

import { http } from '@/shared/http';

const BASE = '/ym/finance';

export const financeOperationsApi = {
  /** Страница операций по id (из P&L или из ссылки ИИ-ответа). */
  operations: async (ids: readonly string[]): Promise<FinanceOperation[]> =>
    (await http.post<{ items: FinanceOperation[] }>(`${BASE}/operations`, { ids })).items,

  original: (documentId: string): Promise<DownloadedFile> =>
    http.file(`${BASE}/documents/${encodeURIComponent(documentId)}/original`),
};
