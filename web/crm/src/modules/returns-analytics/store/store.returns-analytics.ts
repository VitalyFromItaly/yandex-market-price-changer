import type { ReturnsAnalyticsResponse, ReturnsMarketplace } from '../returns-analytics.domain';
import type { MarketplaceKey } from '@/navigation.sections';
import type { DayRange } from '@/shared/utils';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { RETURNS_ANALYTICS_KIND } from '../returns-analytics.domain';

import { useReturnsPeriod } from './composables/useReturnsPeriod.returns-analytics';
import { useReturnsView } from './composables/useReturnsView.returns-analytics';

import { useBaseState, useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Аналитики возвратов» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид экрана. Замок задачи — на (продавец, kind), поэтому
 * ответ сверяется с эхом периода: быстрое переключение иначе показало бы прошлый.
 * Площадка (TASK-182) — из адреса, тоже часть эха.
 */
export const useReturnsAnalyticsStore = defineStore('returns-analytics', () => {
  const period = useReturnsPeriod();
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');

  const job = useReportJob<ReturnsAnalyticsResponse, DayRange>({
    launch: (range) => ({
      kind: RETURNS_ANALYTICS_KIND,
      params: { from: range.from, to: range.to, marketplace: marketplace.value },
      store: '',
    }),
    isOwn: (data, range) =>
      (data.marketplace ?? 'ym') === marketplace.value && sameRange(data.period, range),
  });

  const marketplaces = computed<readonly ReturnsMarketplace[]>(
    () => job.data.value?.marketplaces ?? [],
  );
  const view = useReturnsView(marketplaces, marketplace);

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
    marketplace,
    load,
    retry: job.retry,
    /** Площадка экрана (TASK-182); другая — ответ прежней сброшен, период остаётся. */
    selectMarketplace(next: MarketplaceKey): void {
      if (next === marketplace.value) return;
      job.reset();
      setMarketplace(next);
    },
    reset() {
      period.reset();
      view.reset();
      job.reset();
      resetMarketplace();
    },
  };
});
