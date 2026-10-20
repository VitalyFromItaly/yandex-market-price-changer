import { defineStore } from 'pinia';

import { useSettings } from './composables/useSettings.settings';

/** Стор раздела «Настройки» — тонкий фасад над слайсом. */
export const useSettingsStore = defineStore('settings', () => {
  const settings = useSettings();
  return {
    ...settings,
    reset() {
      settings.reset();
    },
  };
});
