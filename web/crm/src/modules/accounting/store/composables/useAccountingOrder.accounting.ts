import type {
  AccountingOrderCardResponse,
  AccountingOrderRequest,
  AccountingOrderCardView,
} from '../../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_ORDER_KIND } from '../../accounting.domain';
import { mapAccountingOrderCard } from '../../mappers/mapAccountingOrderCard.accounting';

import { useReportJob } from '@/shared/composables';

export function isOwnOrder(
  data: AccountingOrderCardResponse,
  request: AccountingOrderRequest,
): boolean {
  return data.marketplace === request.marketplace && data.orderId === request.orderId;
}

/**
 * Карточка заказа «Финучёта» (TASK-223): фоновая задача `accounting:order`. Номер
 * уникален только внутри площадки — своё сверяется по паре площадка + номер.
 */
export function useAccountingOrder() {
  const job = useReportJob<AccountingOrderCardResponse, AccountingOrderRequest>({
    launch: (request) => ({
      kind: ACCOUNTING_ORDER_KIND,
      params: { marketplace: request.marketplace, orderId: request.orderId },
      store: request.store,
    }),
    isOwn: isOwnOrder,
  });

  const card = computed<AccountingOrderCardView | null>(() =>
    job.data.value === null ? null : mapAccountingOrderCard(job.data.value),
  );

  return {
    orderCard: card,
    /** Какой заказ открыт — диалог открыт, пока не null. */
    orderRequest: computed(() => job.request.value),
    orderLoading: job.isLoading,
    orderRefreshing: job.isRefreshing,
    orderSavedAt: job.savedAt,
    orderError: job.error,
    openOrder: job.run,
    retryOrder: job.retry,
    closeOrder: job.reset,
    reset: job.reset,
  };
}
