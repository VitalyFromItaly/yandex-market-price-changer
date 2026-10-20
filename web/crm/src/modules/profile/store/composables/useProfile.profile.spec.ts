import type { Profile } from '../../profile.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useProfileStore } from '../store.profile';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.profile', () => ({ profileApi: api }));

const PROFILE: Profile = {
  facts: [{ label: 'Пользователь', value: 'Вася' }],
  features: [],
};

beforeEach(() => {
  api.get.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useProfile', () => {
  it('загрузка кладёт профиль; ошибка — текстом, без профиля', async () => {
    const store = useProfileStore();
    api.get.mockResolvedValueOnce(PROFILE);
    await store.load();
    expect(store.profile).toEqual(PROFILE);
    expect(store.error).toBeNull();

    store.reset();
    api.get.mockRejectedValueOnce(new Error('Сервер недоступен'));
    await store.load();
    expect(store.profile).toBeNull();
    expect(store.error).toBe('Сервер недоступен');
    expect(store.isLoading).toBe(false);
  });

  it('resetAllStores чистит профиль — чужие данные не мелькнут после выхода', async () => {
    const store = useProfileStore();
    api.get.mockResolvedValueOnce(PROFILE);
    await store.load();
    resetAllStores();
    expect(store.profile).toBeNull();
  });
});
