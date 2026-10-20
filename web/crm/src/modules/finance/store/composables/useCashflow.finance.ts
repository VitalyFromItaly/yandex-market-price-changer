import type { Cashflow } from '../../finance.domain';

import { ref } from 'vue';

import { financeApi } from '../../api/financeApi.finance';

import { useBaseState } from '@/shared/composables';

/**
 * ДДС месяца, выплаты и «к получению» (переехал из «Закупок»). Ответ,
 * пришедший после смены месяца, отбрасывается.
 */
export function useCashflow() {
  const [cashflow, setCashflow, isLoading, resetCashflow] = useBaseState<Cashflow | null>(null);
  const error = ref<string | null>(null);
  let generation = 0;

  async function loadCashflow(month: string): Promise<void> {
    const run = ++generation;
    isLoading.value = true;
    error.value = null;
    try {
      const result = await financeApi.cashflow(month);
      if (run === generation) setCashflow(result);
    } catch (e) {
      if (run === generation) {
        error.value = e instanceof Error ? e.message : 'Не удалось посчитать движение денег';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  function reset(): void {
    generation += 1;
    resetCashflow();
    error.value = null;
  }

  return {
    cashflow,
    cashflowLoading: isLoading,
    cashflowError: error,
    loadCashflow,
    reset,
  };
}
