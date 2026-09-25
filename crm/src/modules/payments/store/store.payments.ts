import { defineStore } from 'pinia';

import { usePaymentsOptions } from './composables/usePaymentsOptions.payments';
import { usePaymentsReport } from './composables/usePaymentsReport.payments';

/** Стор «Платежей» — тонкий фасад: варианты формы и сам отчёт. */
export const usePaymentsStore = defineStore('payments', () => {
  const options = usePaymentsOptions();
  const report = usePaymentsReport();
  return {
    ...options,
    ...report,
    reset() {
      options.reset();
      report.reset();
    },
  };
});
