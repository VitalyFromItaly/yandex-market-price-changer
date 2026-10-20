import type { NotificationSettings, SettingsBody } from '../../notifications.domain';

import { ref } from 'vue';

import { notificationsApi } from '../../api/notificationsApi.notifications';

import { useBaseState } from '@/shared/composables';

/**
 * Настройки правил: загрузка и запись. Запись заменяет состояние ответом
 * сервера; ошибки записи пробрасываются — под какое поле их ставить, решает форма.
 */
export function useNotificationSettings() {
  const [settings, setSettings, settingsLoading, resetSettings] =
    useBaseState<NotificationSettings | null>(null);
  const settingsError = ref<string | null>(null);

  async function loadSettings(): Promise<void> {
    settingsLoading.value = true;
    settingsError.value = null;
    try {
      setSettings(await notificationsApi.settings());
    } catch (e) {
      settingsError.value = e instanceof Error ? e.message : 'Не удалось загрузить настройки';
    } finally {
      settingsLoading.value = false;
    }
  }

  async function saveSettings(body: SettingsBody): Promise<void> {
    setSettings(await notificationsApi.saveSettings(body));
  }

  function reset(): void {
    resetSettings();
    settingsError.value = null;
  }

  return { settings, settingsLoading, settingsError, loadSettings, saveSettings, reset };
}
