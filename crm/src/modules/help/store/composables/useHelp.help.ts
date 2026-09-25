import type { Help } from '../../help.domain';

import { computed, ref } from 'vue';

import { helpApi } from '../../api/helpApi.help';

import { usePersistedState } from '@/shared/cache';

/**
 * Справка. Текст меняется только с выкладкой, но запрос при открытии всё равно
 * уходит — иначе после выкладки продавец читал бы старую справку до выхода.
 * Пока он идёт, на экране прошлая (кэш экрана). Ошибка — текстом для экрана.
 */
export function useHelp() {
  const state = usePersistedState<Help>(() => ({ kind: 'help', store: '' }));
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    if (state.isLoading.value) return;
    state.isLoading.value = true;
    error.value = null;
    try {
      state.set(await helpApi.get());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить справку';
    } finally {
      state.isLoading.value = false;
    }
  }

  function reset(): void {
    state.reset();
    error.value = null;
  }

  return {
    help: state.value,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    savedAt: state.savedAt,
    hasHelp: computed(() => state.value.value !== null),
    error,
    load,
    reset,
  };
}
