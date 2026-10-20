import type { FbyReport, FbyResponse } from '../../fby.domain';

import { computed } from 'vue';

import { FBY_JOB_KIND } from '../../fby.domain';
import { mapFby } from '../../mappers/mapFby.fby';

import { useReportJob } from '@/shared/composables';

interface Request {
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Сводка FBY фоновой задачей. Параметров нет, поэтому чужого результата не
 * бывает (`isOwn` — всегда да). Вход в раздел пересобирает срез, прошлый тем
 * временем на экране. Лимит отчёта остатков (1/мин) держит сервер — у
 * FbyStockService мемо на 60 с, так что частые заходы Маркет не дёргают.
 */
export function useFbyReport() {
  const job = useReportJob<FbyResponse, Request>({
    launch: (current) => ({ kind: FBY_JOB_KIND, params: {}, store: current.store }),
    isOwn: () => true,
  });

  const report = computed<FbyReport | null>(() =>
    job.data.value === null ? null : mapFby(job.data.value),
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

  function download(): Promise<void> {
    return job.download(report.value?.file?.filename);
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
    download,
    reset: job.reset,
  };
}
