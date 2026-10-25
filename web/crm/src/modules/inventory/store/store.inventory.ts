import type { InventoryResponse } from '../inventory.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { defineStore } from 'pinia';

import { INVENTORY_KIND } from '../inventory.domain';

import { useReportJob } from '@/shared/composables';

/**
 * Стор «Склада» — фасад над фоновой задачей уровня аккаунта (`store: ''`).
 * Параметр — площадка экрана (TASK-182, из адреса): ответ сверяется с её эхом.
 * Срез собирается минутами (отчёты ЯМ, заказы WB), поэтому повторный вход в
 * раздел той же площадки задачу не ставит — свежий срез берётся «Обновить».
 */
export const useInventoryStore = defineStore('inventory', () => {
  const job = useReportJob<InventoryResponse, MarketplaceKey>({
    launch: (marketplace) => ({ kind: INVENTORY_KIND, params: { marketplace }, store: '' }),
    isOwn: (data, marketplace) => (data.marketplace ?? 'ym') === marketplace,
  });

  /** При открытии раздела: эта площадка собирается или уже есть — новую задачу не ставим. */
  function ensure(marketplace: MarketplaceKey): void {
    if (job.request.value === marketplace) return;
    void job.run(marketplace);
  }

  function refresh(): void {
    void job.run(job.request.value ?? 'ym');
  }

  return {
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    ensure,
    refresh,
    retry: job.retry,
    reset: job.reset,
  };
});
