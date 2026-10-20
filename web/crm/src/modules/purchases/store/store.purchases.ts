import { defineStore } from 'pinia';

import { usePurchases } from './composables/usePurchases.purchases';

/**
 * Стор раздела «Закупки» — фасад записей. ДДС переехал в «Финансы»
 * (TASK-124) и перечитывается там при открытии вкладки.
 */
export const usePurchasesStore = defineStore('purchases', () => {
  const purchases = usePurchases();
  return {
    ...purchases,
    // Общий reset — последним, перекрывает reset слайсов.
    reset() {
      purchases.reset();
    },
  };
});
