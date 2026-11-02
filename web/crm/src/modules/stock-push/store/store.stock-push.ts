import { defineStore } from 'pinia';

import { usePushSchedule } from './composables/usePushSchedule.stock-push';

/** Стор синхронизации остатков — тонкий фасад над слайсом частоты. */
export const useStockPushStore = defineStore('stock-push', () => {
  const schedule = usePushSchedule();
  return {
    ...schedule,
    reset() {
      schedule.reset();
    },
  };
});
