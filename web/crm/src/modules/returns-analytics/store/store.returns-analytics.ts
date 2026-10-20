import type { ReturnsAnalyticsResponse, ReturnsMarketplace } from '../returns-analytics.domain';
import type { DayRange } from '@/shared/utils';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { RETURNS_ANALYTICS_KIND } from '../returns-analytics.domain';

import { useReturnsPeriod } from './composables/useReturnsPeriod.returns-analytics';
import { useReturnsView } from './composables/useReturnsView.returns-analytics';

import { useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Аналитики возвратов» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид экрана. Замок задачи — на (продавец, kind), поэтому
 * ответ сверяется с эхом периода: быстрое переключение иначе показало бы прошлый.
 */
export const useReturnsAnalyticsStore = defineStore('returns-analytics', () => {
  const period = useReturnsPeriod();

  const job = useReportJob<ReturnsAnalyticsResponse, DayRange>({
    launch: (range) => ({
      kind: RETURNS_ANALYTICS_KIND,
      params: { from: range.from, to: range.to },
      store: '',
    }),
    isOwn: (data, range) => sameRange(data.period, range),
  });

  const marketplaces = computed<readonly ReturnsMarketplace[]>(
    () => job.data.value?.marketplaces ?? [],
  );
  const view = useReturnsView(marketplaces);

  function load(): void {
    const range = period.range.value;
    if (range !== null) void job.run(range);
  }

  return {
    ...period,
    ...view,
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    load,
    retry: job.retry,
    reset() {
      period.reset();
      view.reset();
      job.reset();
    },
  };
});
