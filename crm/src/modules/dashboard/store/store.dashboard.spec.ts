import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useDashboardStore } from './store.dashboard';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  file: vi.fn(),
  saveFile: vi.fn(),
  http: vi.fn(),
}));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));
vi.mock('@/shared/http', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  http: { get: api.http },
}));

const KINDS: Record<string, { key: string; period: { key: string; day: null } }> = {
  'orders:in_transit': { key: 'in_transit', period: { key: 'all', day: null } },
  'orders:returning': { key: 'returning', period: { key: 'all', day: null } },
  'orders:shipped_today': { key: 'shipped_today', period: { key: 'today', day: null } },
};

function ordersData(key: string, period: { key: string; day: null }) {
  return {
    key,
    title: key,
    count: 3,
    totals: { sales: 300, subsidies: 0, withDelivery: 300 },
    period,
    periodTitle: 'за сегодня',
    takenAt: null,
    assembling: null,
    returns: null,
    notes: [],
    emptyText: 'Пусто.',
    rows: [],
    file: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(api)) fn.mockReset();
  api.http.mockResolvedValue({ priceListUpdatedAt: '2026-09-20T10:00:00Z' });
  api.start.mockImplementation((kind: string) => Promise.resolve({ jobId: kind, created: true }));
  api.get.mockImplementation((jobId: string) => {
    const meta = KINDS[jobId];
    if (!meta)
      return Promise.resolve({
        jobId,
        kind: jobId,
        status: 'failed',
        data: null,
        error: 'Маркет не ответил',
        file: null,
      });
    return Promise.resolve({
      jobId,
      kind: jobId,
      status: 'done',
      data: ordersData(meta.key, meta.period),
      error: null,
      file: null,
    });
  });
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('стор главной', () => {
  it('каждая открытая плитка — своя задача с периодом плитки; закрытая не ставится', async () => {
    const store = useDashboardStore();
    store.load(['in_transit', 'returning', 'shipped_today'], 's1');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.start).toHaveBeenCalledWith('orders:in_transit', {}, 's1');
    expect(api.start).toHaveBeenCalledWith('orders:returning', { period: { key: 'all' } }, 's1');
    expect(api.start).toHaveBeenCalledWith(
      'orders:shipped_today',
      { period: { key: 'today' } },
      's1',
    );
    expect(api.start).not.toHaveBeenCalledWith('profit:profit', expect.anything());
    expect(api.http).toHaveBeenCalledWith('/profile');
  });

  it('падение одной плитки не трогает остальные', async () => {
    const store = useDashboardStore();
    store.load(['in_transit', 'profit'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(store.tiles.profit.error).toBe('Маркет не ответил');
    expect(store.tiles.in_transit.error).toBeNull();
    expect(store.tiles.in_transit.summary?.value).toBe('3');
    expect(store.priceList.info).toEqual({ updatedAt: '2026-09-20T10:00:00Z' });
  });

  it('результат со страницы с другим периодом не показывается, плитка перезапускается', async () => {
    api.get.mockResolvedValueOnce({
      jobId: 'orders:shipped_today',
      kind: 'orders:shipped_today',
      status: 'done',
      data: ordersData('shipped_today', { key: 'week', day: null }),
      error: null,
      file: null,
    });
    const store = useDashboardStore();
    store.load(['shipped_today'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.tiles.shipped_today.summary).toBeNull();
    expect(store.tiles.shipped_today.isLoading).toBe(true);
    expect(api.start).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.tiles.shipped_today.summary?.value).toBe('3');
  });

  it('reset чистит плитки и дату прайса', async () => {
    const store = useDashboardStore();
    store.load(['in_transit'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    resetAllStores();
    expect(store.tiles.in_transit.summary).toBeNull();
    expect(store.priceList.info).toBeNull();
  });
});
