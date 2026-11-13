import type {
  AccountingDashboardRequest,
  AccountingDashboardResponse,
  AccountingDashboardView,
  AccountingPeriod,
  DashboardFilter,
  DashboardPeriodEcho,
} from '../../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_DASHBOARD_KIND } from '../../accounting.domain';
import { mapAccountingDashboard } from '../../mappers/mapAccountingDashboard.accounting';

import { useReportJob } from '@/shared/composables';

/** Эхо периода сервера — тот же диапазон «с — по», что ушёл в задачу. */
export function sameEchoRange(echo: DashboardPeriodEcho, range: AccountingPeriod): boolean {
  return echo.range !== null && echo.range.from === range.from && echo.range.to === range.to;
}

export function sameFilter(a: DashboardFilter, b: DashboardFilter): boolean {
  return (
    a.marketplace === b.marketplace &&
    a.brand === b.brand &&
    a.offerId === b.offerId &&
    a.orderId === b.orderId
  );
}

/** Параметры задачи панели: период — всегда диапазоном. */
export function dashboardParams(request: AccountingDashboardRequest): Record<string, unknown> {
  return {
    basis: request.basis,
    range: { from: request.range.from, to: request.range.to },
    marketplace: request.filter.marketplace,
    brand: request.filter.brand,
    offerId: request.filter.offerId,
    orderId: request.filter.orderId,
  };
}

/** Ответ относится к запросу: базис, период и фильтр (замок задачи общий на kind и магазин). */
export function isOwnDashboard(
  data: AccountingDashboardResponse,
  request: AccountingDashboardRequest,
): boolean {
  return (
    data.basis === request.basis &&
    sameEchoRange(data.periodEcho, request.range) &&
    sameFilter(data.filter, request.filter)
  );
}

/** Панель «Финучёта» (TASK-231): фоновая задача `accounting:dashboard`, не GET. */
export function useAccountingDashboard() {
  const job = useReportJob<AccountingDashboardResponse, AccountingDashboardRequest>({
    launch: (request) => ({
      kind: ACCOUNTING_DASHBOARD_KIND,
      params: dashboardParams(request),
      store: request.store,
    }),
    isOwn: isOwnDashboard,
  });

  const dashboard = computed<AccountingDashboardView | null>(() =>
    job.data.value === null ? null : mapAccountingDashboard(job.data.value),
  );

  return {
    dashboard,
    dashboardLoading: job.isLoading,
    dashboardRefreshing: job.isRefreshing,
    dashboardSavedAt: job.savedAt,
    dashboardError: job.error,
    loadDashboard: job.run,
    retryDashboard: job.retry,
    reset: job.reset,
  };
}
