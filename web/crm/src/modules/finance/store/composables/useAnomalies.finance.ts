import type { AnomaliesModel, AnomalyFilter } from '../../finance.domain';

import { computed, ref } from 'vue';

import { financeApi } from '../../api/financeApi.finance';
import { ANOMALIES_PAGE_SIZE } from '../../finance.domain';
import { toAnomaliesModel } from '../../mappers/mapAnomalies.finance';

import { useBaseState } from '@/shared/composables';

/**
 * Аномалии месяца (TASK-149): страница, фильтр «новые / все», отметка
 * «просмотрено». Поздний ответ прежнего месяца, страницы или фильтра
 * отбрасывается — довод `usePagedList` сверки.
 */
export function useAnomalies() {
  const [anomalies, setAnomalies, anomaliesLoading, resetAnomalies] =
    useBaseState<AnomaliesModel | null>(null);
  const anomaliesPage = ref(1);
  const anomaliesFilter = ref<AnomalyFilter>('new');
  const anomaliesError = ref<string | null>(null);
  const reviewError = ref<string | null>(null);
  const reviewing = ref<string | null>(null);
  let month: string | null = null;
  let generation = 0;

  async function fetchAnomalies(nextMonth: string, nextPage = 1): Promise<void> {
    const run = ++generation;
    month = nextMonth;
    anomaliesPage.value = nextPage;
    anomaliesLoading.value = true;
    anomaliesError.value = null;
    try {
      const skip = (nextPage - 1) * ANOMALIES_PAGE_SIZE;
      const result = await financeApi.anomalies(
        nextMonth,
        skip,
        ANOMALIES_PAGE_SIZE,
        anomaliesFilter.value === 'new',
      );
      if (run === generation) setAnomalies(toAnomaliesModel(result));
    } catch (e) {
      if (run === generation) {
        anomaliesError.value = e instanceof Error ? e.message : 'Не удалось загрузить аномалии';
      }
    } finally {
      if (run === generation) anomaliesLoading.value = false;
    }
  }

  const anomaliesPages = computed(() =>
    anomalies.value === null
      ? 0
      : Math.max(1, Math.ceil(anomalies.value.total / ANOMALIES_PAGE_SIZE)),
  );

  function turnAnomalies(next: number): Promise<void> {
    return month === null ? Promise.resolve() : fetchAnomalies(month, next);
  }

  function filterAnomalies(next: AnomalyFilter): Promise<void> {
    anomaliesFilter.value = next;
    return month === null ? Promise.resolve() : fetchAnomalies(month, 1);
  }

  /** Отметить или вернуть — и перечитать страницу: под фильтром «новые» строка уходит. */
  async function reviewAnomaly(key: string, reviewed: boolean): Promise<void> {
    if (month === null) return;
    reviewing.value = key;
    reviewError.value = null;
    try {
      await financeApi.reviewAnomalies([key], reviewed);
      await fetchAnomalies(month, anomaliesPage.value);
      // Последняя строка страницы ушла под фильтром — шаг назад, а не пустая страница.
      const pages = anomaliesPages.value;
      if (anomaliesPage.value > pages && pages > 0) await fetchAnomalies(month, pages);
    } catch (e) {
      reviewError.value = e instanceof Error ? e.message : 'Не удалось сохранить отметку';
    } finally {
      reviewing.value = null;
    }
  }

  function reset(): void {
    generation += 1;
    month = null;
    resetAnomalies();
    anomaliesPage.value = 1;
    anomaliesFilter.value = 'new';
    anomaliesError.value = null;
    reviewError.value = null;
    reviewing.value = null;
  }

  return {
    anomalies,
    anomaliesLoading,
    anomaliesPage,
    anomaliesPages,
    anomaliesFilter,
    anomaliesError,
    reviewError,
    reviewing,
    loadAnomalies: (nextMonth: string) => fetchAnomalies(nextMonth, 1),
    turnAnomalies,
    filterAnomalies,
    reviewAnomaly,
    reset,
  };
}
