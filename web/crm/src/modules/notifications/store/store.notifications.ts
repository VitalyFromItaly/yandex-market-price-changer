import { defineStore } from 'pinia';

import { useFeed } from './composables/useFeed.notifications';
import { useNotificationSettings } from './composables/useNotificationSettings.notifications';

/** Стор раздела «Уведомления» — фасад: лента и настройки правил. */
export const useNotificationsStore = defineStore('notifications', () => {
  const feed = useFeed();
  const settings = useNotificationSettings();
  const { reset: resetFeed, ...feedRest } = feed;
  const { reset: resetSettings, ...settingsRest } = settings;
  return {
    ...feedRest,
    ...settingsRest,
    reset() {
      resetFeed();
      resetSettings();
    },
  };
});
