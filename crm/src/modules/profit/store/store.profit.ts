import { defineStore } from 'pinia';

import { useProfitReport } from './composables/useProfitReport.profit';

/** Стор раздела «Прибыль» — тонкий фасад над слайсом. */
export const useProfitStore = defineStore('profit', () => {
  const report = useProfitReport();
  return {
    ...report,
    reset() {
      report.reset();
    },
  };
});
