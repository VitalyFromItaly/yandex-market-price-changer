import type { Settings } from '../../settings.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useSettingsStore } from '../store.settings';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  saveProfit: vi.fn(),
  savePromotion: vi.fn(),
  disablePromotion: vi.fn(),
}));
vi.mock('../../api/settingsApi.settings', () => ({ settingsApi: api }));

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    commissionPercent: 23,
    taxPercent: 7,
    discountPercent: 10,
    brands: [],
    otherCount: 0,
    promotion: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useSettings', () => {
  it('загрузка кладёт вид; ошибка — текстом, без вида', async () => {
    const store = useSettingsStore();
    api.get.mockResolvedValueOnce(settings());
    await store.load();
    expect(store.settings?.commissionPercent).toBe(23);
    expect(store.error).toBeNull();

    store.reset();
    api.get.mockRejectedValueOnce(new Error('Магазин не подключён'));
    await store.load();
    expect(store.settings).toBeNull();
    expect(store.error).toBe('Магазин не подключён');
  });

  it('запись заменяет вид ответом сервера', async () => {
    const store = useSettingsStore();
    api.saveProfit.mockResolvedValueOnce(settings({ taxPercent: 6 }));
    await store.saveProfit({ taxPercent: 6 });
    expect(api.saveProfit).toHaveBeenCalledWith({ taxPercent: 6 });
    expect(store.settings?.taxPercent).toBe(6);

    api.disablePromotion.mockResolvedValueOnce(settings({ promotion: [] }));
    await store.disablePromotion('casio');
    expect(api.disablePromotion).toHaveBeenCalledWith('casio');
    expect(store.settings?.promotion).toEqual([]);
  });

  it('ошибка записи пробрасывается, вид не трогается', async () => {
    const store = useSettingsStore();
    api.get.mockResolvedValueOnce(settings());
    await store.load();
    api.savePromotion.mockRejectedValueOnce(new Error('Порог должен быть…'));
    await expect(
      store.savePromotion('casio', { mode: 'flat', percent: 2, from: -1 }),
    ).rejects.toThrow('Порог');
    expect(store.settings?.commissionPercent).toBe(23);
  });

  it('resetAllStores чистит настройки — чужой магазин не мелькнёт', async () => {
    const store = useSettingsStore();
    api.get.mockResolvedValueOnce(settings());
    await store.load();
    resetAllStores();
    expect(store.settings).toBeNull();
    expect(store.error).toBeNull();
  });
});
