import { defineStore } from 'pinia';

import { useFbyReport } from './composables/useFbyReport.fby';

/** Стор «FBY» — тонкий фасад над слайсом. */
export const useFbyStore = defineStore('fby', () => {
  const report = useFbyReport();
  return {
    ...report,
    reset() {
      report.reset();
    },
  };
});
