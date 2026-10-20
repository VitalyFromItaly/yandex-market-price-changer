import type { SalesAnalyticsResponse, SalesRequest, SalesSku } from '../sales-analytics.domain';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { SALES_ANALYTICS_KIND } from '../sales-analytics.domain';

import { useSalesPeriod } from './composables/useSalesPeriod.sales-analytics';
import { useSalesView } from './composables/useSalesView.sales-analytics';

import { useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Аналитики продаж» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид экрана. Замок задачи — на (продавец, kind), поэтому
 * ответ сверяется с эхом обоих периодов: быстрое переключение иначе показало
 * бы прошлый.
 */
export const useSalesAnalyticsStore = defineStore('sales-analytics', () => {
  const period = useSalesPeriod();

  const job = useReportJob<SalesAnalyticsResponse, SalesRequest>({
    launch: (request) => ({
      kind: SALES_ANALYTICS_KIND,
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
    load,
    retry: job.retry,
    reset() {
      period.reset();
      view.reset();
      job.reset();
    },
  };
});
