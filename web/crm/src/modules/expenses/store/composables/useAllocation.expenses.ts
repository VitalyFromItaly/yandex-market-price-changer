import type { AllocationPreset, ExpenseAllocation } from '../../expenses.domain';

import { ref } from 'vue';

import { expensesApi } from '../../api/expensesApi.expenses';
import { moscowToday, presetRange } from '../../mappers/mapAllocation.expenses';

import { useBaseState } from '@/shared/composables';

/**
 * Сколько расходов ложится в период — то же распределение, что вычтет P&L.
 * Ответ, пришедший после смены пресета, отбрасывается: на экране только число
 * того периода, который выбран сейчас.
 */
export function useAllocation(today: () => string = () => moscowToday()) {
  const [allocation, setAllocation, isLoading, resetAllocation] =
    useBaseState<ExpenseAllocation | null>(null);
  const preset = ref<AllocationPreset>('month');
  const error = ref<string | null>(null);
  let generation = 0;

  async function refresh(): Promise<void> {
    const run = ++generation;
    isLoading.value = true;
    error.value = null;
    try {
      const result = await expensesApi.allocation(presetRange(preset.value, today()));
      if (run === generation) setAllocation(result);
    } catch (e) {
      if (run === generation) {
        error.value = e instanceof Error ? e.message : 'Не удалось посчитать расходы за период';
      }
    } finally {
      if (run === generation) isLoading.value = false;
    }
  }

  async function choose(next: AllocationPreset): Promise<void> {
    preset.value = next;
    await refresh();
  }

  function reset(): void {
    generation += 1;
    resetAllocation();
    preset.value = 'month';
    error.value = null;
  }

  return { allocation, preset, isLoading, error, refresh, choose, reset };
}
