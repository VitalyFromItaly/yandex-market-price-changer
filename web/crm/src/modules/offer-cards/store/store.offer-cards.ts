import { defineStore } from 'pinia';

import { useCardsReport } from './composables/useCardsReport.offer-cards';

/** Стор «Карточек» — тонкий фасад над слайсом. */
export const useOfferCardsStore = defineStore('offer-cards', () => {
  const report = useCardsReport();
  return {
    ...report,
    reset() {
      report.reset();
    },
  };
});
