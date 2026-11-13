import type {
  AccountingDashboardDrillRequest,
  AccountingDashboardDrillResponse,
  AccountingDashboardDrillView,
} from '../../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_DASHBOARD_DRILL_KIND } from '../../accounting.domain';
import { mapAccountingDashboardDrill } from '../../mappers/mapAccountingDashboardDrill.accounting';

import { dashboardParams, sameEchoRange } from './useAccountingDashboard.accounting';

import { useReportJob } from '@/shared/composables';

export function isOwnDrill(
  data: AccountingDashboardDrillResponse,
  request: AccountingDashboardDrillRequest,
): boolean {
  const block = data.marketplace ?? 'all';
  return (
    data.basis === request.basis &&
    data.line === request.line &&
    block === request.block &&
    sameEchoRange(data.periodEcho, request.range)
  );
}

/**
 * Раскрытие строки панели до операций (TASK-231): фоновая задача
 * `accounting:dashboard-drill`; диалог открыт, пока есть запрос.
 */
export function useAccountingDashboardDrill() {
  const job = useReportJob<AccountingDashboardDrillResponse, AccountingDashboardDrillRequest>({
    launch: (request) => ({
      kind: ACCOUNTING_DASHBOARD_DRILL_KIND,
      params: { ...dashboardParams(request), line: request.line, block: request.block },
      store: request.store,
    }),
    isOwn: isOwnDrill,
  });

  const drill = computed<AccountingDashboardDrillView | null>(() =>
    job.data.value === null ? null : mapAccountingDashboardDrill(job.data.value),
  );

  return {
    drill,
    drillRequest: computed(() => job.request.value),
    drillLoading: job.isLoading,
    drillRefreshing: job.isRefreshing,
    drillSavedAt: job.savedAt,
    drillError: job.error,
    openDrill: job.run,
    retryDrill: job.retry,
    closeDrill: job.reset,
    reset: job.reset,
  };
}
