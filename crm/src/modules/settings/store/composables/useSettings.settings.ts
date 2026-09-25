import type { PromoBody, ProfitSettingsBody, Settings } from '../../settings.domain';

import { ref } from 'vue';

import { settingsApi } from '../../api/settingsApi.settings';

import { useBaseState } from '@/shared/composables';

/**
 * Настройки прибыли магазина: загрузка и три записи. Каждая запись заменяет
 * состояние ответом сервера — на экране то, что действительно сохранено.
 * Ошибки записи пробрасываются: под какое поле их ставить, решает форма.
 */
export function useSettings() {
  const [settings, setSettings, isLoading, resetSettings, hasSettings] =
    useBaseState<Settings | null>(null);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setSettings(await settingsApi.get());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить настройки';
    } finally {
      isLoading.value = false;
    }
  }

  async function saveProfit(body: ProfitSettingsBody): Promise<void> {
    setSettings(await settingsApi.saveProfit(body));
  }

  async function savePromotion(brand: string, body: PromoBody): Promise<void> {
    setSettings(await settingsApi.savePromotion(brand, body));
  }

  async function disablePromotion(brand: string): Promise<void> {
    setSettings(await settingsApi.disablePromotion(brand));
  }

  function reset(): void {
    resetSettings();
    error.value = null;
  }

  return {
    settings,
    isLoading,
    hasSettings,
    error,
    load,
    saveProfit,
    savePromotion,
    disablePromotion,
    reset,
  };
}
