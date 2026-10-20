import type { Help } from '../../help.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useHelpStore } from '../store.help';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/helpApi.help', () => ({ helpApi: api }));

const HELP: Help = {
  sections: [],
  supportContact: '@Vitality45',
  supportUrl: 'https://t.me/Vitality45',
};

beforeEach(() => {
  api.get.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useHelp', () => {
  it('каждое открытие идёт на сервер (после выкладки справка свежая), идущий запрос не дублирует', async () => {
    const store = useHelpStore();
    api.get.mockResolvedValue(HELP);
    const first = store.load();
    const second = store.load();
    await Promise.all([first, second]);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(store.help).toEqual(HELP);

    await store.load();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('ошибка — текстом, повтор снова идёт на сервер', async () => {
    const store = useHelpStore();
    api.get.mockRejectedValueOnce(new Error('Сервер недоступен'));
    await store.load();
    expect(store.help).toBeNull();
    expect(store.error).toBe('Сервер недоступен');

    api.get.mockResolvedValueOnce(HELP);
    await store.load();
    expect(store.help).toEqual(HELP);
    expect(store.error).toBeNull();
  });

  it('resetAllStores чистит справку', async () => {
    const store = useHelpStore();
    api.get.mockResolvedValueOnce(HELP);
    await store.load();
    resetAllStores();
    expect(store.help).toBeNull();
  });
});
