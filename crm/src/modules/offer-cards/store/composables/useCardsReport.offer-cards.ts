import type { CardsReport, CardsResponse } from '../../offer-cards.domain';

import { computed } from 'vue';

import { mapCards } from '../../mappers/mapCards.offer-cards';
import { CARDS_JOB_KIND } from '../../offer-cards.domain';

import { useReportJob } from '@/shared/composables';

interface Request {
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Срез карточек — фоновой задачей. Параметров нет, поэтому любой готовый
 * результат kind-а в этом магазине — свой.
 */
export function useCardsReport() {
  const job = useReportJob<CardsResponse, Request>({
    launch: (current) => ({ kind: CARDS_JOB_KIND, params: {}, store: current.store }),
    isOwn: () => true,
  });

  const report = computed<CardsReport | null>(() =>
    job.data.value === null ? null : mapCards(job.data.value),
  );

  /** Пересобрать срез при входе в раздел — прошлый тем временем на экране. */
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
