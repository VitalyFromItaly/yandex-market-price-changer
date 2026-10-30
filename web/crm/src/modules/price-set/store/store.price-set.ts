import type { PriceSetMarketplace, PriceSetMarkups } from '../price-set.domain';

import { defineStore } from 'pinia';

import { useApply } from './composables/useApply.price-set';
import { usePlan } from './composables/usePlan.price-set';
import { usePriceListDay } from './composables/usePriceListDay.price-set';

/**
 * Стор раздела «Установка цен» — тонкий фасад: план (наценка или файл) и его
 * запись на отмеченные площадки без снятых строк.
 */
export const usePriceSetStore = defineStore('price-set', () => {
  const plan = usePlan();
  const writer = useApply();
  const priceList = usePriceListDay();

  /** Новый план — прошлый итог записи уже не о нём. */
  async function planByMarkup(markups: PriceSetMarkups): Promise<void> {
    writer.reset();
    await plan.byMarkup(markups);
  }

  async function planByFile(file: File, marketplaces: PriceSetMarketplace[]): Promise<void> {
    writer.reset();
    await plan.byFile(file, marketplaces);
  }

  async function apply(
    marketplaces: readonly PriceSetMarketplace[],
    excluded: readonly string[],
  ): Promise<void> {
    const current = plan.data.value;
    const planJobId = plan.jobId.value;
    if (!current || planJobId === null || !marketplaces.length) return;
    await writer.apply({ planJobId, planHash: current.planHash, marketplaces, excluded });
  }

  return {
    plan: plan.data,
    planLoading: plan.isLoading,
    hasPlanRequest: plan.hasRequest,
    planErrors: plan.errors,
    planFailure: plan.failure,
    planByMarkup,
    planByFile,
    retryPlan: plan.retry,
    clearFileError: plan.clearFileError,

    applyError: writer.formError,
    isApplySubmitting: writer.isSubmitting,
    isWriting: writer.isWriting,
    writeFailure: writer.failure,
    writeResult: writer.resultLines,
    apply,

    priceListDay: priceList.day,
    ensurePriceListDay: priceList.ensure,

    reset() {
      plan.reset();
      writer.reset();
      priceList.reset();
    },
  };
});
