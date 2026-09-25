import type { RecommendationsReport, RecommendationsResponse } from '../../recommendations.domain';

import { computed } from 'vue';

import { mapRecommendations } from '../../mappers/mapRecommendations.recommendations';
import { RECOMMENDATIONS_JOB_KIND } from '../../recommendations.domain';

import { useReportJob } from '@/shared/composables';

interface Request {
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Срез рекомендаций — фоновой задачей. Параметров у отчёта нет, поэтому любой
 * готовый результат задачи этого kind-а в этом магазине — свой.
 */
export function useRecommendationsReport() {
  const job = useReportJob<RecommendationsResponse, Request>({
    launch: (current) => ({ kind: RECOMMENDATIONS_JOB_KIND, params: {}, store: current.store }),
    isOwn: () => true,
  });

  const report = computed<RecommendationsReport | null>(() =>
    job.data.value === null ? null : mapRecommendations(job.data.value),
  );

  /**
   * Пересобрать срез при входе в раздел — прошлый тем временем на экране.
   * Квота Маркета 100/мин, а срез — пара запросов: заход её не выбирает.
   */
  async function ensure(store: string): Promise<void> {
    // Запрос при каждом открытии; прошлые данные тем временем на экране (кэш).
    // Не дублируем только идущую сборку этого же магазина.
    if (job.request.value?.store === store && job.isLoading.value) return;
    await job.run({ store });
  }

  /** Собрать срез заново. */
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
