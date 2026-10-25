import type {
  DashboardRequest,
  MarketplacesDashboardResponse,
} from '../marketplaces-dashboard.domain';

import { defineStore } from 'pinia';

import { MARKETPLACES_DASHBOARD_KIND } from '../marketplaces-dashboard.domain';

import { useReportJob } from '@/shared/composables';
import { sameRange, useRangeWithPrevious } from '@/shared/period';

/**
 * Стор дашборда «Площадки» — фасад: период и фоновая задача уровня аккаунта
 * (`store: ''`). Ответ сверяется с эхом обоих периодов, как у «Сравнения
 * площадок»: замок задачи — на (продавец, kind).
 */
export const useMarketplacesDashboardStore = defineStore('marketplaces-dashboard', () => {
  const period = useRangeWithPrevious();

  const job = useReportJob<MarketplacesDashboardResponse, DashboardRequest>({
    launch: (request) => ({
      kind: MARKETPLACES_DASHBOARD_KIND,
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
