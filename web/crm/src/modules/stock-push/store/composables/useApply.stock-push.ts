import type { StockPushApplyResult } from '../../stock-push.domain';

import { computed } from 'vue';

import { stockPushApi } from '../../api/stockPushApi.stock-push';
import { applyLines, mapApplyError } from '../../mappers/mapStockPush.stock-push';

import { useBaseState, useJob } from '@/shared/composables';

/**
 * Запись плана: постановка задачи → опрос → итог. Барьеры (фичи, env, модель,
 * отпечаток плана, порог обнулений) решает сервер; здесь только показ.
 */
export function useApply() {
  const [formError, setFormError, isSubmitting, resetFormError] = useBaseState<string | null>(null);
  const job = useJob<StockPushApplyResult>();

  async function apply(planHash: string): Promise<void> {
    job.reset();
    resetFormError();
    isSubmitting.value = true;
    try {
      const { jobId } = await stockPushApi.apply(planHash);
      job.track(jobId);
    } catch (caught) {
      const mapped = mapApplyError(caught);
      setFormError(mapped.message);
      if (mapped.runningJobId !== null) job.track(mapped.runningJobId);
    } finally {
      isSubmitting.value = false;
    }
  }

  const resultLines = computed(() => {
    const view = job.job.value;
    if (view?.status !== 'done' || view.data === null) return null;
    return applyLines(view.data);
  });

  function reset(): void {
    job.reset();
    resetFormError();
  }

  return {
    formError,
    isSubmitting,
    isWriting: job.isRunning,
    failure: job.error,
    resultLines,
    apply,
    reset,
  };
}
