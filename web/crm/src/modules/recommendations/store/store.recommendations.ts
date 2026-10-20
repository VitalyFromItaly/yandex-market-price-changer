import { defineStore } from 'pinia';

import { useRecommendationsReport } from './composables/useRecommendationsReport.recommendations';

/** Стор «Рекомендаций цен» — тонкий фасад над слайсом. */
export const useRecommendationsStore = defineStore('recommendations', () => {
  const report = useRecommendationsReport();
  return {
    ...report,
    reset() {
      report.reset();
    },
  };
});
