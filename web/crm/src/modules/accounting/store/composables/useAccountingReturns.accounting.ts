import type {
  AccountingReturnsRequest,
  AccountingReturnsResponse,
  AccountingReturnsView,
} from '../../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_RETURNS_KIND } from '../../accounting.domain';
import { mapAccountingReturns } from '../../mappers/mapAccountingReturns.accounting';

import { useReportJob } from '@/shared/composables';

/** Ответ относится к запросу: месяц (замок задачи общий на kind и магазин). */
export function isOwnReturns(
  data: AccountingReturnsResponse,
  request: AccountingReturnsRequest,
): boolean {
  return data.period.from.slice(0, 7) === request.month;
}

/** Возвраты месяца «Финучёта» (TASK-225): фоновая задача `accounting:returns`, не GET. */
export function useAccountingReturns() {
  const job = useReportJob<AccountingReturnsResponse, AccountingReturnsRequest>({
    launch: (request) => ({
      kind: ACCOUNTING_RETURNS_KIND,
      params: { month: request.month },
      store: request.store,
    }),
    isOwn: isOwnReturns,
  });

  const returns = computed<AccountingReturnsView | null>(() =>
    job.data.value === null ? null : mapAccountingReturns(job.data.value),
  );

  return {
    returns,
    returnsLoading: job.isLoading,
    returnsRefreshing: job.isRefreshing,
    returnsSavedAt: job.savedAt,
    returnsError: job.error,
    loadReturns: job.run,
    retryReturns: job.retry,
    reset: job.reset,
  };
}
