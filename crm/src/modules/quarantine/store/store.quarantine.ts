import { defineStore } from 'pinia';

import { useQuarantineConfirm } from './composables/useQuarantineConfirm.quarantine';
import { useQuarantineList } from './composables/useQuarantineList.quarantine';

/** Стор «Карантина цен» — фасад: список и подтверждение (перезагружает список). */
export const useQuarantineStore = defineStore('quarantine', () => {
  const list = useQuarantineList();
  const confirming = useQuarantineConfirm(list.load);

  return {
    view: list.view,
    isLoading: list.isLoading,
    isRefreshing: list.isRefreshing,
    savedAt: list.savedAt,
    loadError: list.error,
    load: list.load,

    isConfirming: confirming.isConfirming,
    confirmError: confirming.error,
    confirm: confirming.confirm,

    reset() {
      list.reset();
      confirming.reset();
    },
  };
});
