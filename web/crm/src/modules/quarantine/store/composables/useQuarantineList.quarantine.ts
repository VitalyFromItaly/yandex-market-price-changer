import type { QuarantineView } from '../../quarantine.domain';

import { ref } from 'vue';

import { quarantineApi } from '../../api/quarantineApi.quarantine';

import { usePersistedState } from '@/shared/cache';
import { useBaseState } from '@/shared/composables';

/**
 * Список карантина. Ответ, пришедший после более нового запроса, выбрасывается:
 * перезагрузка после подтверждения не должна проиграть гонку старому ответу.
 *
 * Пока идёт запрос, на экране прошлый список этого магазина (кэш экрана).
 * Действовать по нему безопасно: перед записью сервер сверяет запрос с живым
 * списком и ушедшее не трогает.
 */
export function useQuarantineList() {
  const [store, setStore, , resetStore] = useBaseState<string | null>(null);
  const state = usePersistedState<QuarantineView>(() =>
    store.value === null ? null : { kind: 'quarantine', store: store.value },
  );
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(next: string): Promise<void> {
    const run = ++generation;
    setStore(next);
    state.isLoading.value = true;
    error.value = null;
    try {
      const view = await quarantineApi.list(next);
      if (run === generation) state.set(view);
    } catch (caught) {
      if (run === generation) {
        error.value = caught instanceof Error ? caught.message : 'Не удалось получить карантин цен';
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
