import type { SalesAnalyticsResponse, SalesRequest, SalesSku } from '../sales-analytics.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { SALES_ANALYTICS_KIND } from '../sales-analytics.domain';

import { useSalesPeriod } from './composables/useSalesPeriod.sales-analytics';
import { useSalesView } from './composables/useSalesView.sales-analytics';

import { useBaseState, useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Аналитики продаж» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид экрана. Замок задачи — на (продавец, kind), поэтому
 * ответ сверяется с эхом обоих периодов: быстрое переключение иначе показало
 * бы прошлый. Площадка (TASK-181) — из адреса, тоже часть эха.
 */
export const useSalesAnalyticsStore = defineStore('sales-analytics', () => {
  const period = useSalesPeriod();
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');

  const job = useReportJob<SalesAnalyticsResponse, SalesRequest>({
    launch: (request) => ({
      kind: SALES_ANALYTICS_KIND,
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

  const skus = computed<readonly SalesSku[]>(() => job.data.value?.skus ?? []);
  const view = useSalesView(skus);

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
