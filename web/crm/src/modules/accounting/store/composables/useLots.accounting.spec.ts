import type { AccountingLotsResponse } from '../../accounting.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { lotResponse } from '../../mappers/accountingLots.fixtures.accounting';
import { useAccountingStore } from '../store.accounting';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ lots: vi.fn() }));
vi.mock('../../api/accountingApi.accounting', () => ({ accountingApi: api }));

const RESPONSE: AccountingLotsResponse = {
  lots: [lotResponse()],
  totals: { remaining: 1, remainingCostKopecks: 100_333 },
};

beforeEach(() => {
  api.lots.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('партии в сторе «Финучёта»', () => {
  it('loadLots кладёт ответ, reset очищает', async () => {
    api.lots.mockResolvedValue(RESPONSE);
    const store = useAccountingStore();
    await store.loadLots();
    expect(store.lots).toEqual(RESPONSE);
    expect(store.hasLots).toBe(true);
    expect(store.lotsLoading).toBe(false);
    resetAllStores();
    expect(store.lots).toBeNull();
  });

  it('ошибка — текстом, без исключения', async () => {
    api.lots.mockRejectedValue(new Error('Нет доступа'));
    const store = useAccountingStore();
    await store.loadLots();
    expect(store.lotsError).toBe('Нет доступа');
    expect(store.lotsLoading).toBe(false);
  });

  it('запоздавший ответ прежнего запроса не затирает новый', async () => {
    let releaseOld: (value: AccountingLotsResponse) => void = () => undefined;
    api.lots
      .mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce(RESPONSE);
    const store = useAccountingStore();
    const old = store.loadLots();
    await store.loadLots();
    releaseOld({ lots: [], totals: { remaining: 0, remainingCostKopecks: 0 } });
    await old;
    expect(store.lots).toEqual(RESPONSE);
  });
});
