import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { costHistoryView, costRecord } from '../../mappers/costHistory.fixtures.accounting';
import { useAccountingStore } from '../store.accounting';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  costProducts: vi.fn(),
  costHistory: vi.fn(),
  correctCost: vi.fn(),
}));
vi.mock('../../api/accountingApi.accounting', () => ({ accountingApi: api }));

const A1 = { id: 'p1', internalSku: 'A1', name: 'Часы' };
const B2 = { id: 'p2', internalSku: 'B2', name: null };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('история закупа v2 в сторе «Финучёта»', () => {
  it('поиск отдаёт ответ и запоминает валюты формы', async () => {
    api.costProducts.mockResolvedValue({ total: 1, items: [A1], currencies: ['RUR', 'USD'] });
    const store = useAccountingStore();
    const response = await store.findCostProducts('час');
    expect(api.costProducts).toHaveBeenCalledWith('час');
    expect(response.items).toEqual([A1]);
    expect(store.costCurrencies).toEqual(['RUR', 'USD']);
  });

  it('выбор товара грузит его историю; ответ прежнего товара не перетирает новый', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    api.costHistory
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(costHistoryView({ records: [costRecord({ id: 'b' })] }));
    const store = useAccountingStore();
    const first = store.selectCostProduct(A1);
    await store.selectCostProduct(B2);
    resolveFirst(costHistoryView({ records: [costRecord({ id: 'a' })] }));
    await first;
    expect(api.costHistory.mock.calls.map(([id]) => id)).toEqual(['p1', 'p2']);
    expect(store.costProduct).toEqual(B2);
    expect(store.costHistory?.records[0]?.id).toBe('b');
    expect(store.costHistoryLoading).toBe(false);
  });

  it('сбой загрузки — текст ошибки; исправление заменяет вид ответом и пробрасывает отказ', async () => {
    api.costHistory.mockRejectedValueOnce(new Error('Сервер недоступен'));
    const store = useAccountingStore();
    await store.selectCostProduct(A1);
    expect(store.costHistoryError).toBe('Сервер недоступен');

    const body = {
      validFrom: '2026-10-01T09:00:00.000Z',
      price: '900',
      currency: 'RUR',
      rate: null,
      extraCosts: null,
      reason: 'Счёт',
    };
    api.correctCost.mockResolvedValueOnce(costHistoryView({ records: [costRecord({ id: 'n' })] }));
    await store.correctCost(body);
    expect(api.correctCost).toHaveBeenCalledWith('p1', body);
    expect(store.costHistory?.records[0]?.id).toBe('n');

    api.correctCost.mockRejectedValueOnce(new Error('Укажите причину'));
    await expect(store.correctCost(body)).rejects.toThrow('Укажите причину');
  });

  it('reset очищает товар, вид и валюты; запоздалый ответ после него не возвращается', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.costHistory.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    api.costProducts.mockResolvedValue({ total: 0, items: [], currencies: ['RUR'] });
    const store = useAccountingStore();
    await store.findCostProducts('x');
    const load = store.selectCostProduct(A1);
    resetAllStores();
    resolve(costHistoryView());
    await load;
    expect(store.costProduct).toBeNull();
    expect(store.costHistory).toBeNull();
    expect(store.costCurrencies).toEqual([]);
  });
});
