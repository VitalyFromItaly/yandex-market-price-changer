import type { TaxReductionBody, TaxReductionsView } from '../../taxes.domain';

import { ref } from 'vue';

import { taxesApi } from '../../api/taxesApi.taxes';

import { useBaseState } from '@/shared/composables';

/**
 * Уменьшения налога (взносы и прочее): список и запись. Запись отвечает полным
 * списком и заменяет его; ошибка записи пробрасывается — поле решает диалог.
 */
export function useTaxReductions() {
  const [reductions, setReductions, reductionsLoading, resetReductions, hasReductions] =
    useBaseState<TaxReductionsView | null>(null);
  const reductionsError = ref<string | null>(null);

  async function loadReductions(): Promise<void> {
    reductionsLoading.value = true;
    reductionsError.value = null;
    try {
      setReductions(await taxesApi.reductions());
    } catch (e) {
      reductionsError.value = e instanceof Error ? e.message : 'Не удалось загрузить уменьшения';
    } finally {
      reductionsLoading.value = false;
    }
  }

  async function saveReduction(id: string | null, body: TaxReductionBody): Promise<void> {
    setReductions(
      id === null ? await taxesApi.createReduction(body) : await taxesApi.updateReduction(id, body),
    );
  }

  async function removeReduction(id: string): Promise<void> {
    setReductions(await taxesApi.removeReduction(id));
  }

  function reset(): void {
    resetReductions();
    reductionsError.value = null;
  }

  return {
    reductions,
    reductionsLoading,
    hasReductions,
    reductionsError,
    loadReductions,
    saveReduction,
    removeReduction,
    resetReductions: reset,
  };
}
