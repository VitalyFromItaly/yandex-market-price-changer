import type {
  AccountingOrdersRequest,
  AccountingOrdersResponse,
  AccountingOrdersView,
} from '../../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_ORDERS_KIND } from '../../accounting.domain';
import { mapAccountingOrders } from '../../mappers/mapAccountingOrders.accounting';

import { useReportJob } from '@/shared/composables';

/** Ответ относится к запросу: месяц и эхо фильтра (замок задачи общий на kind и магазин). */
export function isOwnOrders(
  data: AccountingOrdersResponse,
  request: AccountingOrdersRequest,
): boolean {
  const echo = data.filter;
  return (
    data.period.from.slice(0, 7) === request.month &&
    echo.marketplace === request.marketplace &&
    echo.state === request.state &&
    echo.lossOnly === request.lossOnly
  );
}

/**
 * Заказы месяца «Финучёта» (TASK-223): фоновая задача `accounting:orders`, не GET.
 * Пустые фильтры в params не уходят — сервер их и так читает как «все».
 */
export function useAccountingOrders() {
  const job = useReportJob<AccountingOrdersResponse, AccountingOrdersRequest>({
    launch: (request) => ({
      kind: ACCOUNTING_ORDERS_KIND,
      params: {
        month: request.month,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        ...(request.state ? { state: request.state } : {}),
        lossOnly: request.lossOnly,
      },
      store: request.store,
    }),
    isOwn: isOwnOrders,
  });

  const orders = computed<AccountingOrdersView | null>(() =>
    job.data.value === null ? null : mapAccountingOrders(job.data.value),
  );

  return {
    orders,
    ordersLoading: job.isLoading,
    ordersRefreshing: job.isRefreshing,
    ordersSavedAt: job.savedAt,
    ordersError: job.error,
    loadOrders: job.run,
    retryOrders: job.retry,
    reset: job.reset,
  };
}
