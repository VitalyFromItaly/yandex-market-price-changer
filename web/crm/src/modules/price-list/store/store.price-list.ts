import { defineStore } from 'pinia';

import { usePurchasePrices } from './composables/usePurchasePrices.price-list';
import { useUpload } from './composables/useUpload.price-list';

/** Стор раздела «Прайс» — тонкий фасад над двумя слайсами: загрузка и закуп. */
export const usePriceListStore = defineStore('price-list', () => {
  const upload = useUpload();
  const prices = usePurchasePrices();

  return {
    uploadAccepted: upload.accepted,
    uploadErrors: upload.errors,
    isSubmitting: upload.isSubmitting,
    isProcessing: upload.isProcessing,
    uploadFailure: upload.failure,
    uploadResult: upload.result,
    upload: upload.upload,
    clearFileError: upload.clearFileError,

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
      prices.reset();
    },
  };
});
