import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useAccountingStore } from './store.accounting';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('../api/accountingApi.accounting', () => ({ accountingApi: api }));

const SYNC = { asOf: null, everyHours: 3, reloadMonths: 3, marketplaces: [] };

beforeEach(() => {
  api.sync.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useAccountingStore', () => {
  it('load кладёт журнал синхронизации, reset очищает', async () => {
    api.sync.mockResolvedValue(SYNC);
    const store = useAccountingStore();
    await store.load();
    expect(store.sync).toEqual(SYNC);
    expect(store.hasSync).toBe(true);
    resetAllStores();
    expect(store.sync).toBeNull();
  });

  it('ошибка сервера — текстом, без исключения', async () => {
    api.sync.mockRejectedValue(new Error('500'));
    const store = useAccountingStore();
    await store.load();
    expect(store.error).toBe('500');
    expect(store.isLoading).toBe(false);
  });

  it('заказы и карточка — пустые до запроса, reset закрывает карточку', () => {
    const store = useAccountingStore();
    expect(store.orders).toBeNull();
    expect(store.orderCard).toBeNull();
    expect(store.orderRequest).toBeNull();
    resetAllStores();
    expect(store.orderRequest).toBeNull();
  });

  it('возвраты — пустые до запроса и после reset', () => {
    const store = useAccountingStore();
    expect(store.returns).toBeNull();
    expect(store.returnsError).toBeNull();
    resetAllStores();
    expect(store.returns).toBeNull();
  });

  it('панель, раскрытие и аналитика — пустые до запроса и после reset', () => {
    const store = useAccountingStore();
    expect(store.dashboard).toBeNull();
    expect(store.drill).toBeNull();
    expect(store.drillRequest).toBeNull();
    expect(store.analytics).toBeNull();
    resetAllStores();
    expect(store.dashboard).toBeNull();
    expect(store.drillRequest).toBeNull();
    expect(store.analytics).toBeNull();
  });

  it('партии и режим себестоимости — пустые до запроса и после reset', () => {
    const store = useAccountingStore();
    expect(store.lots).toBeNull();
    expect(store.costSettings).toBeNull();
    resetAllStores();
    expect(store.lots).toBeNull();
    expect(store.costSettings).toBeNull();
    expect(store.lotsError).toBeNull();
    expect(store.costSettingsError).toBeNull();
  });
});
