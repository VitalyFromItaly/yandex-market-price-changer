import type {
  AccountingLotsResponse,
  AccountingMarketplace,
  CostCorrectionBody,
  CostHistoryView,
  CostMethod,
  CostProductsResponse,
  CostSettingsResponse,
  ManualOperationBody,
  ManualOperationChange,
  ManualOperationsView,
  ReconcileResponse,
  SyncResponse,
  WbPromotionUploadResponse,
} from '../accounting.domain';

import { http } from '@/shared/http';

const BASE = '/ym/accounting';
const MANUAL = `${BASE}/manual-operations`;
const COST_HISTORY = `${BASE}/cost-history`;

export const accountingApi = {
  /** Журнал синхронизации: по площадке и месяцу окна — попытка, успех, ошибка, пропуск. */
  sync: (): Promise<SyncResponse> => http.get<SyncResponse>(`${BASE}/sync`),

  /** Ручные операции (TASK-208): каждая запись отвечает полным видом раздела. */
  manual: (): Promise<ManualOperationsView> => http.get<ManualOperationsView>(MANUAL),

  createManual: (body: ManualOperationBody): Promise<ManualOperationsView> =>
    http.post<ManualOperationsView>(MANUAL, body),

  updateManual: (id: string, body: ManualOperationBody): Promise<ManualOperationsView> =>
    http.put<ManualOperationsView>(`${MANUAL}/${encodeURIComponent(id)}`, body),

  removeManual: (id: string): Promise<ManualOperationsView> =>
    http.delete<ManualOperationsView>(`${MANUAL}/${encodeURIComponent(id)}`),

  /**
   * Сверка v2 месяца «ГГГГ-ММ» (TASK-226/227): статьи реестра против документов площадки.
   * Без площадки сервер берёт первую доступную.
   */
  reconcile: (
    month: string,
    marketplace: AccountingMarketplace | null,
  ): Promise<ReconcileResponse> =>
    http.get<ReconcileResponse>(
      `${BASE}/reconcile?month=${encodeURIComponent(month)}` +
        (marketplace ? `&marketplace=${marketplace}` : ''),
    ),

  manualHistory: (id: string): Promise<{ items: ManualOperationChange[] }> =>
    http.get<{ items: ManualOperationChange[] }>(`${MANUAL}/${encodeURIComponent(id)}/history`),

  /** Отчёт WB «Продвижение» файлом (TASK-209) — справочная реклама месяца `month`. */
  uploadWbPromotion: (file: File, month: string): Promise<WbPromotionUploadResponse> => {
    const form = new FormData();
    form.append('month', month);
    form.append('file', file, file.name);
    return http.upload<WbPromotionUploadResponse>(`${BASE}/uploads/wb-promotion`, form);
  },

  /** Партии с остатками (TASK-216): остаток — FIFO сервера по продажам всех площадок. */
  lots: (): Promise<AccountingLotsResponse> => http.get<AccountingLotsResponse>(`${BASE}/lots`),

  /** Режим себестоимости А/Б (TASK-215). */
  costSettings: (): Promise<CostSettingsResponse> =>
    http.get<CostSettingsResponse>(`${BASE}/cost/settings`),

  saveCostSettings: (method: CostMethod): Promise<CostSettingsResponse> =>
    http.post<CostSettingsResponse>(`${BASE}/cost/settings`, { method }),

  /**
   * История закупа v2 (TASK-235): поиск товара — своя ручка «Финучёта», ей не нужна
   * фича «Товаров» (решение accounting_cost_history_product_search).
   */
  costProducts: (q: string): Promise<CostProductsResponse> =>
    http.get<CostProductsResponse>(`${COST_HISTORY}/products?q=${encodeURIComponent(q)}`),

  costHistory: (productId: string): Promise<CostHistoryView> =>
    http.get<CostHistoryView>(`${COST_HISTORY}/${encodeURIComponent(productId)}`),

  /** Исправление прошлой цены отвечает историей товара целиком. */
  correctCost: (productId: string, body: CostCorrectionBody): Promise<CostHistoryView> =>
    http.post<CostHistoryView>(
      `${COST_HISTORY}/${encodeURIComponent(productId)}/corrections`,
      body,
    ),
};
