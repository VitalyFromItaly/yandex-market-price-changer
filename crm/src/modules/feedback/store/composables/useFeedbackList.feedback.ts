import type { FeedbackView } from '../../feedback.domain';

import { ref } from 'vue';

import { feedbackApi } from '../../api/feedbackApi.feedback';

import { usePersistedState } from '@/shared/cache';
import { useBaseState } from '@/shared/composables';

/**
 * Список отзывов без ответа. Ответ, пришедший после более нового запроса,
 * выбрасывается: перезагрузка после публикации не должна проиграть гонку
 * старому ответу, где отзыв ещё числится.
 *
 * Пока идёт запрос, на экране прошлый список этого магазина (кэш экрана).
 * Действовать по нему безопасно: перед записью сервер сверяет запрос с живым
 * списком и ушедшее не трогает.
 */
export function useFeedbackList() {
  const [store, setStore, , resetStore] = useBaseState<string | null>(null);
  const state = usePersistedState<FeedbackView>(() =>
    store.value === null ? null : { kind: 'feedback', store: store.value },
  );
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(next: string): Promise<void> {
    const run = ++generation;
    setStore(next);
    state.isLoading.value = true;
    error.value = null;
    try {
      const view = await feedbackApi.list(next);
      if (run === generation) state.set(view);
    } catch (caught) {
      if (run === generation) {
        error.value = caught instanceof Error ? caught.message : 'Не удалось получить отзывы';
      }
    } finally {
      if (run === generation) state.isLoading.value = false;
    }
  }

  function reset(): void {
    generation += 1;
    state.reset();
    resetStore();
    error.value = null;
  }

  return {
    view: state.value,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    savedAt: state.savedAt,
    error,
    load,
    reset,
  };
}
