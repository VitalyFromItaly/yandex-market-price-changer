import type { StockPushPlan } from '../../price-list.domain';

import { STOCK_PUSH_KIND } from '../../price-list.domain';

import { useReportJob } from '@/shared/composables';

/**
 * План «Передачи остатков» — задача уровня аккаунта (свой склад один на все
 * магазины и площадки). Читает заказы и остатки всех площадок — минуты,
 * поэтому повторный вход задачу не ставит; новый прайс и «Обновить» — ставят.
 */
export function usePushPlan() {
  const job = useReportJob<StockPushPlan, true>({
    launch: () => ({ kind: STOCK_PUSH_KIND, params: {}, store: '' }),
    isOwn: () => true,
  });

  function ensure(): void {
    if (job.request.value !== null) return;
    void job.run(true);
  }

  function refresh(): void {
    void job.run(true);
  }

  return {
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    ensure,
    refresh,
    retry: job.retry,
    reset: job.reset,
  };
}
