import type { ReconcileResponse } from '../../accounting.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useAccountingStore } from '../store.accounting';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock('../../api/accountingApi.accounting', () => ({ accountingApi: api }));

const response = (from: string, marketplace: 'ym' | 'ozon' | 'wb' = 'ym'): ReconcileResponse => ({
  period: { from, to: from },
  marketplace,
  marketplaceOptions: [],
  status: 'reconciled',
  partial: true,
  notes: [],
  reconciledAt: '2026-11-08T08:00:00.000Z',
  dataAsOf: null,
  lines: [],
  acts: [],
  paymentOrders: [],
  storeLevel: { items: [], count: 0, totalKopecks: 0 },
  unmatchedCount: 0,
  candidateCount: 0,
  discrepantOrderIds: [],
});

beforeEach(() => {
  api.reconcile.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('сверка v2 в сторе «Финучёта»', () => {
  it('loadReconcile кладёт ответ месяца, reset очищает', async () => {
    api.reconcile.mockResolvedValue(response('2026-09-01'));
    const store = useAccountingStore();
    await store.loadReconcile('2026-09');
    expect(api.reconcile).toHaveBeenCalledWith('2026-09', null);
    expect(store.reconcile?.period.from).toBe('2026-09-01');
    expect(store.hasReconcile).toBe(true);
    expect(store.reconcileMonth).toBe('2026-09');
    resetAllStores();
    expect(store.reconcile).toBeNull();
    expect(store.reconcileMonth).toBeNull();
    expect(store.reconcileMarketplace).toBeNull();
  });

  it('ошибка сервера — текстом, загрузка снята', async () => {
    api.reconcile.mockRejectedValue(new Error('500'));
    const store = useAccountingStore();
    await store.loadReconcile('2026-09');
    expect(store.reconcileError).toBe('500');
    expect(store.reconcileLoading).toBe(false);
    expect(store.reconcile).toBeNull();
  });

  it('запоздавший ответ прежнего месяца не затирает новый', async () => {
    let releaseOld: (value: ReconcileResponse) => void = () => undefined;
    api.reconcile
      .mockImplementationOnce(() => new Promise<ReconcileResponse>((r) => (releaseOld = r)))
      .mockResolvedValueOnce(response('2026-10-01'));
    const store = useAccountingStore();
    const old = store.loadReconcile('2026-09');
    await store.loadReconcile('2026-10');
    releaseOld(response('2026-09-01'));
    await old;
    expect(store.reconcile?.period.from).toBe('2026-10-01');
    expect(store.reconcileLoading).toBe(false);
  });

  it('площадка запоминается: смена месяца грузит ту же площадку; запоздавший ответ другой — не затирает', async () => {
    let releaseYm: (value: ReconcileResponse) => void = () => undefined;
    api.reconcile
      .mockImplementationOnce(() => new Promise<ReconcileResponse>((r) => (releaseYm = r)))
      .mockResolvedValueOnce(response('2026-09-01', 'ozon'))
      .mockResolvedValueOnce(response('2026-10-01', 'ozon'));
    const store = useAccountingStore();
    const old = store.loadReconcile('2026-09');
    await store.loadReconcile('2026-09', 'ozon');
    releaseYm(response('2026-09-01'));
    await old;
    expect(store.reconcile?.marketplace).toBe('ozon');

    await store.loadReconcile('2026-10');
    expect(api.reconcile).toHaveBeenLastCalledWith('2026-10', 'ozon');
    expect(store.reconcileMarketplace).toBe('ozon');
  });
});
