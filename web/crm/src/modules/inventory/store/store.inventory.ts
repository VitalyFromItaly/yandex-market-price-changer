import type { InventoryResponse } from '../inventory.domain';

import { defineStore } from 'pinia';

import { INVENTORY_KIND } from '../inventory.domain';

import { useReportJob } from '@/shared/composables';

/**
 * Стор «Склада» — фасад над фоновой задачей уровня аккаунта (`store: ''`).
 * Параметров нет, поэтому любой ответ этого kind-а — свой. Срез собирается
 * минутами (отчёты ЯМ, заказы WB), поэтому повторный вход в раздел задачу не
 * ставит — свежий срез берётся кнопкой «Обновить».
 */
export const useInventoryStore = defineStore('inventory', () => {
  const job = useReportJob<InventoryResponse, true>({
    launch: () => ({ kind: INVENTORY_KIND, params: {}, store: '' }),
    isOwn: () => true,
  });

  /** При открытии раздела: собирается или уже есть — новую задачу не ставим. */
  function ensure(): void {
    if (job.request.value !== null) return;
    void job.run(true);
  }

  function refresh(): void {
    void job.run(true);
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
