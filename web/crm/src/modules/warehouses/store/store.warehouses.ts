import { defineStore } from 'pinia';

import { useWarehousesReport } from './composables/useWarehousesReport.warehouses';

/** Стор «Складов» — тонкий фасад над слайсом. */
export const useWarehousesStore = defineStore('warehouses', () => {
  const report = useWarehousesReport();
  return {
    ...report,
    reset() {
      report.reset();
    },
  };
});
