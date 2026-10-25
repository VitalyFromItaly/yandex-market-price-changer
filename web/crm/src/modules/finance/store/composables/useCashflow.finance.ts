import type { Cashflow, FinanceMarketplace } from '../../finance.domain';
import type { Ref } from 'vue';

import { ref } from 'vue';

import { financeApi } from '../../api/financeApi.finance';
import { isFinanceUnsupported } from '../../constants/marketplaces.finance';

import { useBaseState } from '@/shared/composables';

/**
 * ДДС месяца, выплаты и «к получению» (переехал из «Закупок»). Ответ,
 * пришедший после смены месяца, отбрасывается. У площадки без выплат
 * (Ozon/WB, TASK-180) вместо отчёта — причина в `cashflowNote`.
 */
export function useCashflow(marketplace: Readonly<Ref<FinanceMarketplace>>) {
  const [cashflow, setCashflow, isLoading, resetCashflow] = useBaseState<Cashflow | null>(null);
  const error = ref<string | null>(null);
  const note = ref<string | null>(null);
  let generation = 0;

  async function loadCashflow(month: string): Promise<void> {
    const run = ++generation;
    isLoading.value = true;
    error.value = null;
    try {
      const result = await financeApi.cashflow(marketplace.value, month);
      if (run !== generation) return;
      const unsupported = isFinanceUnsupported(result);
      note.value = unsupported ? result.note : null;
      setCashflow(unsupported ? null : result);
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
    note.value = null;
  }

  return {
    cashflow,
    cashflowLoading: isLoading,
    cashflowError: error,
    cashflowNote: note,
    loadCashflow,
    reset,
  };
}
