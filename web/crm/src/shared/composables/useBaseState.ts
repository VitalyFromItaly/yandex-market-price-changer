import type { ComputedRef, Ref } from 'vue';

import { computed, ref } from 'vue';

export type BaseState<T> = [
  state: Ref<T>,
  setState: (value: T) => void,
  isLoading: Ref<boolean>,
  resetState: () => void,
  hasState: ComputedRef<boolean>,
];

/** Копия начального значения: reset не должен вернуть тот же массив, который успели мутировать `.push`. */
function fresh<T>(value: T): T {
  return typeof value === 'object' && value !== null ? structuredClone(value) : value;
}

/**
 * Реактивное состояние слайса стора: `[state, setState, isLoading, resetState, hasState]`.
 * hasState — «данные есть»: не null/undefined и не пустой массив. Это то, что
 * отличает первую загрузку (скелетон) от пустого ответа (EmptyState).
 */
export function useBaseState<T>(initial: T): BaseState<T> {
  const state = ref(fresh(initial)) as Ref<T>;
  const isLoading = ref(false);

  function setState(value: T): void {
    state.value = value;
  }

  function resetState(): void {
    state.value = fresh(initial);
    isLoading.value = false;
  }

  const hasState = computed(() => {
    const value: unknown = state.value;
    if (value === null || value === undefined) return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });

  return [state, setState, isLoading, resetState, hasState];
}
