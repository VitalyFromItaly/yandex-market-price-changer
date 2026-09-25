import type { WarehousesReport, WarehousesResponse } from '../../warehouses.domain';

import { computed } from 'vue';

import { mapWarehouses } from '../../mappers/mapWarehouses.warehouses';
import { WAREHOUSES_JOB_KIND } from '../../warehouses.domain';

import { useReportJob } from '@/shared/composables';

interface Request {
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Обзор складов фоновой задачей. Параметров нет — `isOwn` всегда да. Вход в
 * раздел пересобирает срез, прошлый тем временем на экране. Лимит отчёта
 * остатков (1/мин, общий с «FBY») держит сервер мемо на 60 с.
 */
export function useWarehousesReport() {
  const job = useReportJob<WarehousesResponse, Request>({
    launch: (current) => ({ kind: WAREHOUSES_JOB_KIND, params: {}, store: current.store }),
    isOwn: () => true,
  });

  const report = computed<WarehousesReport | null>(() =>
    job.data.value === null ? null : mapWarehouses(job.data.value),
  );

  async function ensure(store: string): Promise<void> {
    // Запрос при каждом открытии; прошлые данные тем временем на экране (кэш).
    // Не дублируем только идущую сборку этого же магазина.
    if (job.request.value?.store === store && job.isLoading.value) return;
    await job.run({ store });
  }

  function refresh(store: string): Promise<void> {
    return job.run({ store });
  }

  return {
    report,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    isFresh: job.isFresh,
    savedAt: job.savedAt,
    error: job.error,
    ensure,
    refresh,
    retry: job.retry,
    reset: job.reset,
  };
}
