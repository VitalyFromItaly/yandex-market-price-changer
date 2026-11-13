import type {
  AccountingAnalyticsRequest,
  AccountingAnalyticsResponse,
  AccountingAnalyticsView,
} from '../../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_ANALYTICS_KIND } from '../../accounting.domain';
import { mapAccountingAnalytics } from '../../mappers/mapAccountingAnalytics.accounting';

import { sameEchoRange } from './useAccountingDashboard.accounting';

import { useReportJob } from '@/shared/composables';

export function isOwnAnalytics(
  data: AccountingAnalyticsResponse,
  request: AccountingAnalyticsRequest,
): boolean {
  return sameEchoRange(data.periodEcho, request.range);
}

/** Аналитика «Финучёта» (TASK-231 поверх TASK-230): фоновая задача `accounting:analytics`. */
export function useAccountingAnalytics() {
  const job = useReportJob<AccountingAnalyticsResponse, AccountingAnalyticsRequest>({
    launch: (request) => ({
      kind: ACCOUNTING_ANALYTICS_KIND,
      params: { range: { from: request.range.from, to: request.range.to } },
      store: request.store,
    }),
    isOwn: isOwnAnalytics,
  });

  const analytics = computed<AccountingAnalyticsView | null>(() =>
    job.data.value === null ? null : mapAccountingAnalytics(job.data.value),
  );

  return {
    analytics,
    analyticsLoading: job.isLoading,
    analyticsRefreshing: job.isRefreshing,
    analyticsSavedAt: job.savedAt,
    analyticsError: job.error,
    loadAnalytics: job.run,
    retryAnalytics: job.retry,
    reset: job.reset,
  };
}
