import type { Profile } from '../../profile.domain';

import { computed, ref } from 'vue';

import { profileApi } from '../../api/profileApi.profile';

import { usePersistedState } from '@/shared/cache';

/**
 * Профиль продавца. Загружается при каждом открытии; пока идёт запрос, на
 * экране прошлый профиль (кэш экрана). Ошибка — текстом для экрана.
 */
export function useProfile() {
  const state = usePersistedState<Profile>(() => ({ kind: 'profile', store: '' }));
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    state.isLoading.value = true;
    error.value = null;
    try {
      state.set(await profileApi.get());
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить профиль';
    } finally {
      state.isLoading.value = false;
    }
  }

  function reset(): void {
    state.reset();
    error.value = null;
  }

  return {
    profile: state.value,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    savedAt: state.savedAt,
    hasProfile: computed(() => state.value.value !== null),
    error,
    load,
    reset,
  };
}
