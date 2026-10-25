import type { RatingSku, RatingsRequest, SkuRatingsResponse } from '../sku-ratings.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { SKU_RATINGS_KIND } from '../sku-ratings.domain';

import { useRatingsPeriod } from './composables/useRatingsPeriod.sku-ratings';
import { useRatingsView } from './composables/useRatingsView.sku-ratings';

import { useBaseState, useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Рейтингов» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид экрана. Ответ сверяется с эхом обоих периодов: замок
 * задачи — на (продавец, kind), и быстрое переключение иначе показало бы прошлый.
 * Площадка (TASK-181) — из адреса, тоже часть эха.
 */
export const useSkuRatingsStore = defineStore('sku-ratings', () => {
  const period = useRatingsPeriod();
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');

  const job = useReportJob<SkuRatingsResponse, RatingsRequest>({
    launch: (request) => ({
      kind: SKU_RATINGS_KIND,
      params: {
        from: request.range.from,
        to: request.range.to,
        prevFrom: request.previous.from,
        prevTo: request.previous.to,
        marketplace: marketplace.value,
      },
      store: '',
    }),
    isOwn: (data, request) =>
      (data.marketplace ?? 'ym') === marketplace.value &&
      sameRange(data.period, request.range) &&
      sameRange(data.previousPeriod, request.previous),
  });

  const skus = computed<readonly RatingSku[]>(() => job.data.value?.skus ?? []);
  const view = useRatingsView(skus);

  function load(): void {
    const request = period.request.value;
    if (request !== null) void job.run(request);
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
    /** Площадка экрана (TASK-181); другая — ответ прежней сброшен, период остаётся. */
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
