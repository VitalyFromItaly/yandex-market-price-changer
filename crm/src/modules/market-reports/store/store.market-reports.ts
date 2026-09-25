import { defineStore } from 'pinia';

import { useMarketCategories } from './composables/useMarketCategories.market-reports';
import { useMarketReportJobs } from './composables/useMarketReportJobs.market-reports';
import { useMarketReportsOptions } from './composables/useMarketReportsOptions.market-reports';

/** Стор «Отчётов Маркета» — тонкий фасад: варианты форм, категории, отчёты. */
export const useMarketReportsStore = defineStore('market-reports', () => {
  const options = useMarketReportsOptions();
  const categories = useMarketCategories();
  const jobs = useMarketReportJobs();
  return {
    ...options,
    ...categories,
    ...jobs,
    reset() {
      options.reset();
      categories.reset();
      jobs.reset();
    },
  };
});
