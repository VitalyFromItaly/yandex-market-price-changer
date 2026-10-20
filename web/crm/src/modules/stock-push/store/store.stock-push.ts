import type { StockPushPlan } from '../stock-push.domain';

import { defineStore } from 'pinia';

import { STOCK_PUSH_KIND } from '../stock-push.domain';

import { useApply } from './composables/useApply.stock-push';

import { useReportJob } from '@/shared/composables';

/**
 * Стор «Передачи остатков» — фасад над задачей плана уровня аккаунта и над
 * записью. План читает заказы и остатки всех площадок — минуты, поэтому
 * повторный вход задачу не ставит; «Обновить» пересчитывает.
 */
export const useStockPushStore = defineStore('stock-push', () => {
  const job = useReportJob<StockPushPlan, true>({
    launch: () => ({ kind: STOCK_PUSH_KIND, params: {}, store: '' }),
    isOwn: () => true,
  });
  const writer = useApply();

  function ensure(): void {
    if (job.request.value !== null) return;
    void job.run(true);
  }

  function refresh(): void {
    writer.reset();
    void job.run(true);
  }

  async function apply(): Promise<void> {
    const plan = job.data.value;
    if (!plan) return;
    await writer.apply(plan.planHash);
  }

  function reset(): void {
    job.reset();
    writer.reset();
  }

  return {
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    applyError: writer.formError,
    isSubmitting: writer.isSubmitting,
    isWriting: writer.isWriting,
    writeFailure: writer.failure,
    writeResult: writer.resultLines,
    ensure,
    refresh,
    apply,
    retry: job.retry,
    reset,
  };
});
