import { defineStore } from 'pinia';

import { useAllocation } from './composables/useAllocation.expenses';
import { useExpenses } from './composables/useExpenses.expenses';

/** Стор раздела «Расходы» — фасад: записи и распределение на период. */
export const useExpensesStore = defineStore('expenses', () => {
  const allocation = useAllocation();
  const expenses = useExpenses(() => {
    void allocation.refresh();
  });
  const { error: allocationError, isLoading: allocationLoading, ...allocationRest } = allocation;
  return {
    ...expenses,
    ...allocationRest,
    allocationError,
    allocationLoading,
    // Общий reset — последним, перекрывает reset слайсов.
    reset() {
      expenses.reset();
      allocation.reset();
    },
  };
});
