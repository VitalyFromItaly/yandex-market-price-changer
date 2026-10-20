import type { StoreView } from '../../stores.domain';

import { storesApi } from '../../api/storesApi.stores';

import { useBaseState } from '@/shared/composables';

/**
 * Открытый магазин: подпись, модель и разделы по его модели. Разделы магазина
 * приходят отсюда, а не из `/auth/me`: FBY-раздел открыт в FBY-магазине, даже
 * если в боте активен FBS.
 */
export function useStoreContext() {
  const [current, setCurrent, isLoading, resetCurrent] = useBaseState<StoreView | null>(null);
  const [error, setError, , resetError] = useBaseState<string | null>(null);
  let requested: string | null = null;

  async function open(key: string): Promise<void> {
    if (current.value?.key === key) return;
    requested = key;
    resetCurrent();
    resetError();
    isLoading.value = true;
    try {
      const view = await storesApi.view(key);
      // Пока ждали, открыли другой магазин — этот ответ уже не нужен.
      if (requested === key) setCurrent(view);
    } catch (e) {
      if (requested === key) {
        setError(e instanceof Error ? e.message : 'Не удалось открыть магазин');
      }
    } finally {
      if (requested === key) isLoading.value = false;
    }
  }

  function reset(): void {
    requested = null;
    resetCurrent();
    resetError();
  }

  return { current, isLoading, error, open, reset };
}
