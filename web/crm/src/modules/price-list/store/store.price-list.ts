import type { StockPushMarketplace } from '../price-list.domain';

import { defineStore } from 'pinia';

import { useApply } from './composables/useApply.price-list';
import { usePurchasePrices } from './composables/usePurchasePrices.price-list';
import { usePushPlan } from './composables/usePushPlan.price-list';
import { useUpload } from './composables/useUpload.price-list';

/**
 * Стор раздела «Прайс» — тонкий фасад над слайсами: загрузка, план записи
 * остатков на площадки и его запись, закуп.
 */
export const usePriceListStore = defineStore('price-list', () => {
  const upload = useUpload();
  const plan = usePushPlan();
  const writer = useApply();
  const prices = usePurchasePrices();

  /** Новый прайс или «Обновить» — пересчёт плана; прошлый итог записи уже не о нём. */
  function refreshPlan(): void {
    writer.reset();
    plan.refresh();
  }

  async function applyPlan(marketplaces: readonly StockPushMarketplace[]): Promise<void> {
    const current = plan.data.value;
    if (!current || !marketplaces.length) return;
    await writer.apply(current.planHash, marketplaces);
  }

  return {
    uploadAccepted: upload.accepted,
    uploadErrors: upload.errors,
    isSubmitting: upload.isSubmitting,
    isProcessing: upload.isProcessing,
    uploadFailure: upload.failure,
    uploadResult: upload.result,
    upload: upload.upload,
    clearFileError: upload.clearFileError,

    plan: plan.data,
    planLoading: plan.isLoading,
    planRefreshing: plan.isRefreshing,
    planSavedAt: plan.savedAt,
    planError: plan.error,
    ensurePlan: plan.ensure,
    refreshPlan,
    retryPlan: plan.retry,
    applyError: writer.formError,
    isApplySubmitting: writer.isSubmitting,
    isWriting: writer.isWriting,
    writeFailure: writer.failure,
    writeResult: writer.resultLines,
    applyPlan,

    prices: prices.page,
    pricesQuery: prices.query,
    pricesLoading: prices.isLoading,
    hasPrices: prices.hasPage,
    pricesError: prices.error,
    loadPrices: prices.load,
    searchPrices: prices.search,
    goToPricesPage: prices.goTo,

    reset() {
      upload.reset();
      plan.reset();
      writer.reset();
      prices.reset();
    },
  };
});
