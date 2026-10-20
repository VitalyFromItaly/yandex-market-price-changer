import type { CompareRequest, MarketplaceCompareResponse } from '../marketplace-compare.domain';

import { defineStore } from 'pinia';

import { MARKETPLACE_COMPARE_KIND } from '../marketplace-compare.domain';

import { useComparePeriod } from './composables/useComparePeriod.marketplace-compare';

import { useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Сравнения площадок» — фасад: период и фоновая задача уровня аккаунта
 * (`store: ''`). Замок задачи — на (продавец, kind), поэтому ответ сверяется с
 * эхом обоих периодов: быстрое переключение иначе показало бы прошлый.
 */
export const useMarketplaceCompareStore = defineStore('marketplace-compare', () => {
  const period = useComparePeriod();

  const job = useReportJob<MarketplaceCompareResponse, CompareRequest>({
    launch: (request) => ({
      kind: MARKETPLACE_COMPARE_KIND,
      params: {
        from: request.range.from,
        to: request.range.to,
        prevFrom: request.previous.from,
        prevTo: request.previous.to,
      },
      store: '',
    }),
    isOwn: (data, request) =>
      sameRange(data.period, request.range) && sameRange(data.previousPeriod, request.previous),
  });

  function load(): void {
    const request = period.request.value;
    if (request !== null) void job.run(request);
  }

  return {
    ...period,
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    load,
    retry: job.retry,
    reset() {
      period.reset();
      job.reset();
    },
  };
});
