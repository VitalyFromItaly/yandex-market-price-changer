import type { StoreItem, StoreView } from '../stores.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useStoresStore } from './store.stores';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ list: vi.fn(), view: vi.fn(), replaceToken: vi.fn() }));
vi.mock('../api/storesApi.stores', () => ({ storesApi: api }));

const FBS: StoreItem = {
  key: 'aaaa',
  label: 'Время с SBrand · FBS',
  businessName: 'SBrand',
  placementType: 'FBS',
};
const FBY_VIEW: StoreView = {
  key: 'bbbb',
  label: 'Время с SBrand · FBY',
  businessName: 'SBrand',
  placementType: 'FBY',
  sections: ['ym-dashboard', 'ym-orders'],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useStoresStore', () => {
  it('список: успех кладёт магазины, ошибка — текстом', async () => {
    const store = useStoresStore();
    api.list.mockResolvedValueOnce([FBS]);
    await store.loadList();
    expect(store.stores).toEqual([FBS]);

    store.reset();
    api.list.mockRejectedValueOnce(new Error('Магазин не подключён'));
    await store.loadList();
    expect(store.stores).toBeNull();
    expect(store.listError).toBe('Магазин не подключён');
  });

  it('смена токена заменяет список ответом сервера; отказ пробрасывается, список прежний', async () => {
    const store = useStoresStore();
    api.list.mockResolvedValueOnce([FBS]);
    await store.loadList();

    api.replaceToken.mockRejectedValueOnce(new Error('Яндекс.Маркет отклонил ваш API-токен.'));
    await expect(store.replaceToken('ACMA:bad-token')).rejects.toThrow('отклонил');
    expect(store.stores).toEqual([FBS]);

    const other = { ...FBS, key: 'cccc', label: 'other.ru · FBS' };
    api.replaceToken.mockResolvedValueOnce({ stores: [other], botStore: 'other.ru · FBS' });
    const result = await store.replaceToken('ACMA:new-token');
    expect(result.botStore).toBe('other.ru · FBS');
    expect(store.stores).toEqual([other]);
  });

  it('открытый магазин: тот же ключ не перезапрашивается, другой — да', async () => {
    const store = useStoresStore();
    api.view.mockResolvedValue(FBY_VIEW);
    await store.open('bbbb');
    await store.open('bbbb');
    expect(api.view).toHaveBeenCalledTimes(1);
    expect(store.current?.sections).toEqual(['ym-dashboard', 'ym-orders']);
  });

  it('поздний ответ прежнего магазина не перетирает новый', async () => {
    const store = useStoresStore();
    let resolveFirst: (view: StoreView) => void = () => undefined;
    api.view
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ ...FBY_VIEW, key: 'cccc', label: 'other.ru · FBS' });

    const first = store.open('bbbb');
    await store.open('cccc');
    resolveFirst(FBY_VIEW);
    await first;

    expect(store.current?.key).toBe('cccc');
  });

  it('чужой ключ — ошибка текстом сервера, вида нет; resetAllStores чистит всё', async () => {
    const store = useStoresStore();
    api.view.mockRejectedValueOnce(new Error('Магазин не найден среди магазинов вашего токена'));
    await store.open('zzzz');
    expect(store.current).toBeNull();
    expect(store.currentError).toContain('не найден');

    api.list.mockResolvedValueOnce([FBS]);
    await store.loadList();
    resetAllStores();
    expect(store.stores).toBeNull();
    expect(store.currentError).toBeNull();
  });
});
