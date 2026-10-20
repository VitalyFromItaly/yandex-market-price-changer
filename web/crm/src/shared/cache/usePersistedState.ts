import type { CacheScope } from './reportCache';
import type { ComputedRef, Ref } from 'vue';

import { computed } from 'vue';

import { cacheKey, cacheOwner } from './reportCache';
import { usePersistedResult } from './usePersistedResult';

import { useBaseState } from '@/shared/composables/useBaseState';

export interface PersistedState<T> {
  /** Живое значение этого ключа, иначе сохранённое; `null` — показать нечего. */
  value: ComputedRef<T | null>;
  /** ISO: на какой момент значение; `null` — значения нет. */
  savedAt: ComputedRef<string | null>;
  isLoading: Ref<boolean>;
  /** Идёт загрузка, а на экране уже прошлое значение — полоса, не скелетон. */
  isRefreshing: ComputedRef<boolean>;
  set(data: T): void;
  reset(): void;
}

/**
 * Состояние простой загрузки (один GET) с кэшем экрана: пока идёт запрос,
 * показывается прошлое значение из памяти вкладки или localStorage.
 *
 * Живое значение помнит, для какого ключа получено, и под другим ключом не
 * показывается — ответ магазина А не всплывёт в магазине Б, даже если
 * `reset()` при смене магазина кто-то забудет.
 */
export function usePersistedState<T>(scope: () => CacheScope | null): PersistedState<T> {
  const key = computed(() => {
    const current = scope();
    return current === null ? null : cacheKey(cacheOwner(), current);
  });
  const [live, setLive, isLoading, resetLive] = useBaseState<{
    key: string | null;
    data: T;
  } | null>(null);
  const persisted = usePersistedResult<T>(key);

  const value = computed<T | null>(() => {
    const own = live.value;
    if (own !== null && own.key === key.value) return own.data;
    return persisted.entry.value?.data ?? null;
  });

  const savedAt = computed(() =>
    value.value === null ? null : (persisted.entry.value?.savedAt ?? null),
  );

  function set(data: T): void {
    setLive({ key: key.value, data });
    persisted.save(data);
  }

  return {
    value,
    savedAt,
    isLoading,
    isRefreshing: computed(() => isLoading.value && value.value !== null),
    set,
    reset: resetLive,
  };
}
