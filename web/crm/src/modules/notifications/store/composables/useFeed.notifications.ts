import type { NotificationsFeed } from '../../notifications.domain';

import { ref } from 'vue';

import { notificationsApi } from '../../api/notificationsApi.notifications';

import { useBaseState } from '@/shared/composables';

/**
 * Лента уведомлений: загрузка (все или непрочитанные), отметка прочитанного и
 * «Проверить сейчас». После отметки лента перечитывается — на экране то, что
 * записано. Ошибки действий пробрасываются: тост ставит компонент.
 */
export function useFeed() {
  const [feed, setFeed, isLoading, resetFeed, hasFeed] = useBaseState<NotificationsFeed | null>(
    null,
  );
  const error = ref<string | null>(null);
  const unreadOnly = ref(false);

  async function load(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      setFeed(await notificationsApi.feed(unreadOnly.value));
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить уведомления';
    } finally {
      isLoading.value = false;
    }
  }

  async function setUnreadOnly(value: boolean): Promise<void> {
    unreadOnly.value = value;
    await load();
  }

  async function markRead(ids: string[] | 'all'): Promise<void> {
    await notificationsApi.markRead(ids);
    await load();
  }

  async function checkNow(): Promise<void> {
    await notificationsApi.checkNow();
  }

  function reset(): void {
    resetFeed();
    error.value = null;
    unreadOnly.value = false;
  }

  return {
    feed,
    isLoading,
    hasFeed,
    error,
    unreadOnly,
    load,
    setUnreadOnly,
    markRead,
    checkNow,
    reset,
  };
}
