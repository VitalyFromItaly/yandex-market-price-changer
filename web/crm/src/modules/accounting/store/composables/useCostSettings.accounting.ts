import type { CostMethod, CostSettingsResponse } from '../../accounting.domain';

import { ref } from 'vue';

import { accountingApi } from '../../api/accountingApi.accounting';

import { useBaseState } from '@/shared/composables';

/**
 * Режим себестоимости А/Б (TASK-215/216) — настройка, без кеша: открытие экрана
 * всегда спрашивает сервер. Сохранение заменяет вид ответом и пробрасывает
 * ошибку — её покажет переключатель.
 */
export function useCostSettings() {
  const [costSettings, setCostSettings, costSettingsLoading, resetCostSettings] =
    useBaseState<CostSettingsResponse | null>(null);
  const costSettingsError = ref<string | null>(null);
  let inFlight: Promise<void> | null = null;
  // reset() отрезает ответ запроса, начатого до него (выход, смена продавца).
  let generation = 0;

  function loadCostSettings(): Promise<void> {
    if (inFlight) return inFlight;
    const own = generation;
    costSettingsLoading.value = true;
    costSettingsError.value = null;
    inFlight = accountingApi
      .costSettings()
      .then((response) => {
        if (own === generation) setCostSettings(response);
      })
      .catch((e: unknown) => {
        if (own !== generation) return;
        costSettingsError.value =
          e instanceof Error ? e.message : 'Не удалось загрузить режим себестоимости';
      })
      .finally(() => {
        if (own !== generation) return;
        costSettingsLoading.value = false;
        inFlight = null;
      });
    return inFlight;
  }

  async function saveCostSettings(method: CostMethod): Promise<void> {
    setCostSettings(await accountingApi.saveCostSettings(method));
  }

  function reset(): void {
    resetCostSettings();
    costSettingsError.value = null;
    inFlight = null;
    generation += 1;
  }

  return {
    costSettings,
    costSettingsLoading,
    costSettingsError,
    loadCostSettings,
    saveCostSettings,
    reset,
  };
}
