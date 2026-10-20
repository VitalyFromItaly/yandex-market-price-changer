import { createPinia, defineStore, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from 'vue';

import { useBaseState } from '../composables';

import { resetAllStores, resettableStoresPlugin } from './resettableStores';

const useCounterStore = defineStore('counter-spec', () => {
  const [count, setCount, , resetCount] = useBaseState(0);
  return { count, setCount, reset: resetCount };
});

const useSessionStore = defineStore('session-spec', () => {
  const [token, setToken] = useBaseState<string | null>(null);
  return { token, setToken };
});

describe('resettableStoresPlugin', () => {
  beforeEach(() => {
    const pinia = createPinia().use(resettableStoresPlugin);
    // Плагины pinia применяются только после install в приложение.
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  it('resetAllStores чистит сторы с reset() и не трогает сторы без него', () => {
    const counter = useCounterStore();
    const session = useSessionStore();
    counter.setCount(7);
    session.setToken('t');

    resetAllStores();

    expect(counter.count).toBe(0);
    expect(session.token).toBe('t');
  });
});
