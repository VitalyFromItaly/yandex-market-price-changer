import type { PriceSetApplyRequest, PriceSetApplyResult } from '../../price-set.domain';

import { computed } from 'vue';

import { priceSetApi } from '../../api/priceSetApi.price-set';
import { applyLines, mapApplyError } from '../../mappers/mapPriceSet.price-set';

import { useBaseState, useJob } from '@/shared/composables';

/**
 * Запись плана: постановка задачи → опрос → итог по площадкам. Барьеры (фичи,
 * PRICE_WRITE_ENABLED, отпечаток плана) решает сервер; здесь только показ.
 * Идущая запись (409) — опрашиваем её: продавец видит, чем она кончилась.
 */
export function useApply() {
  const [formError, setFormError, isSubmitting, resetFormError] = useBaseState<string | null>(null);
  const job = useJob<PriceSetApplyResult>();

  async function apply(request: PriceSetApplyRequest): Promise<void> {
    job.reset();
    resetFormError();
    isSubmitting.value = true;
    try {
      const { jobId } = await priceSetApi.apply(request);
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
