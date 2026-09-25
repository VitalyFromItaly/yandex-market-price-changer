import type { PriceListInfo } from '../../dashboard.domain';

import { ref } from 'vue';

import { dashboardApi } from '../../api/dashboardApi.dashboard';

import { usePersistedState } from '@/shared/cache';

/**
 * Дата последней загрузки прайса: null до ответа — отличает первую загрузку от
 * «не загружали». Прошлая дата на плитке, пока идёт запрос (кэш экрана).
 */
export function usePriceListInfo() {
  const state = usePersistedState<PriceListInfo>(() => ({ kind: 'price-list-info', store: '' }));
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    state.isLoading.value = true;
    error.value = null;
    try {
      state.set(await dashboardApi.priceList());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось узнать дату прайса';
    } finally {
      state.isLoading.value = false;
    }
  }

  function reset(): void {
    state.reset();
    error.value = null;
  }

  return {
    info: state.value,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    savedAt: state.savedAt,
    error,
    load,
    reset,
  };
}
