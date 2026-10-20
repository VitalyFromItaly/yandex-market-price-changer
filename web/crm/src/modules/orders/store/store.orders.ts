import { defineStore } from 'pinia';

import { useOrdersReport } from './composables/useOrdersReport.orders';

/** Стор отчётов о заказах — тонкий фасад над слайсом. */
export const useOrdersStore = defineStore('orders', () => {
  const report = useOrdersReport();
  return {
    ...report,
    reset() {
      report.reset();
    },
  };
});
