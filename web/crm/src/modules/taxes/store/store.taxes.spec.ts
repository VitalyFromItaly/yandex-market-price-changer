import type { TaxesView } from '../taxes.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useTaxesStore } from './store.taxes';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../api/taxesApi.taxes', () => ({ taxesApi: api }));

const VIEW = {
  settings: { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' },
  isDefault: true,
  updatedAt: null,
  regimes: [],
  recognitions: [],
  minimumTaxBasisPoints: 100,
} satisfies TaxesView;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Налоги»', () => {
  it('загрузка кладёт вид; ошибка — текстом, без вида', async () => {
    const store = useTaxesStore();
    api.get.mockRejectedValueOnce(new Error('сеть'));
    await store.load();
    expect(store.view).toBeNull();
    expect(store.error).toBe('сеть');

    api.get.mockResolvedValueOnce(VIEW);
    await store.load();
    expect(store.view).toEqual(VIEW);
    expect(store.error).toBeNull();
  });

  it('запись заменяет вид ответом; ошибка записи пробрасывается', async () => {
    const store = useTaxesStore();
    const saved = { ...VIEW, isDefault: false };
    api.save.mockResolvedValueOnce(saved);
    await store.save({ regime: 'usn_income', rate: '6', recognition: 'payment' });
    expect(store.view).toEqual(saved);

    api.save.mockRejectedValueOnce(new Error('400'));
    await expect(
      store.save({ regime: 'usn_income', rate: '9', recognition: 'payment' }),
    ).rejects.toThrow('400');
    expect(store.view).toEqual(saved);
  });

  it('reset через resetAllStores стирает вид', async () => {
    const store = useTaxesStore();
    api.get.mockResolvedValueOnce(VIEW);
    await store.load();
    resetAllStores();
    expect(store.view).toBeNull();
  });
});
