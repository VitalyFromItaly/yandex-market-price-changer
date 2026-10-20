import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

import { cacheKey, setCacheOwner } from './reportCache';
import { clearReportCache } from './usePersistedResult';
import { usePersistedState } from './usePersistedState';

const map = new Map<string, string>();

function setup(store: { value: string | null }) {
  const scope = effectScope();
  const state = scope.run(() =>
    usePersistedState<{ n: number }>(() =>
      store.value === null ? null : { kind: 'quarantine', store: store.value },
    ),
  );
  if (!state) throw new Error('scope');
  return state;
}

beforeEach(() => {
  map.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
  setCacheOwner(() => 'u1');
});

afterEach(() => {
  clearReportCache();
  setCacheOwner(() => null);
  vi.unstubAllGlobals();
});

describe('usePersistedState', () => {
  it('после перезагрузки значение берётся из хранилища; идущая загрузка — «обновление»', () => {
    const key = cacheKey('u1', { kind: 'quarantine', store: 's1' });
    if (key === null) throw new Error('key');
    map.set(key, JSON.stringify({ savedAt: new Date().toISOString(), data: { n: 7 } }));

    const state = setup(ref<string | null>('s1'));
    expect(state.value.value).toEqual({ n: 7 });
    state.isLoading.value = true;
    expect(state.isRefreshing.value).toBe(true);
  });

  it('значение магазина А не показывается в магазине Б, даже без reset', () => {
    const store = ref<string | null>('s1');
    const state = setup(store);
    state.set({ n: 1 });
    expect(state.value.value).toEqual({ n: 1 });

    store.value = 's2';
    expect(state.value.value).toBeNull();
    store.value = 's1';
    expect(state.value.value).toEqual({ n: 1 });
  });

  it('выход стирает кэш: хранилище и память', () => {
    const state = setup(ref<string | null>('s1'));
    state.set({ n: 1 });
    expect([...map.keys()].some((k) => k.includes(':quarantine:'))).toBe(true);

    clearReportCache();
    state.reset();
    expect([...map.keys()].some((k) => k.includes(':quarantine:'))).toBe(false);
  });
});
