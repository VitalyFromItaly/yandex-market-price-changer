import type { StoreItem, TokenReplaced } from '../../stores.domain';

import { storesApi } from '../../api/storesApi.stores';

import { usePersistedState } from '@/shared/cache';
import { useBaseState } from '@/shared/composables';

/**
 * Список магазинов токена и смена токена, которая его обновляет. Пока идёт
 * запрос, на экране прошлый список (кэш экрана).
 */
export function useStoresList() {
  const state = usePersistedState<StoreItem[]>(() => ({ kind: 'stores', store: '' }));
  const [error, setError, , resetError] = useBaseState<string | null>(null);

  async function load(): Promise<void> {
    state.isLoading.value = true;
    resetError();
    try {
      state.set(await storesApi.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить магазины');
    } finally {
      state.isLoading.value = false;
    }
  }

  /** Ошибки пробрасываются: под поле их ставит форма (по `code`). */
  async function replaceToken(token: string): Promise<TokenReplaced> {
    const result = await storesApi.replaceToken(token);
    state.set(result.stores);
    return result;
  }

  function reset(): void {
    state.reset();
    resetError();
  }

  return {
    stores: state.value,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    savedAt: state.savedAt,
    error,
    load,
    replaceToken,
    reset,
  };
}
