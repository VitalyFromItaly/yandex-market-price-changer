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

function profitData(period: { key: string; day: null }) {
  const block = {
    orders: 2,
    revenue: 1000,
    subsidies: 0,
    commission: 230,
    commissionPercent: 23,
    tax: 70,
    taxPercent: 7,
    promo: 0,
    purchase: 500,
    net: 200,
    byDay: [{ date: '2026-09-02', revenue: 1000, net: 200 }],
    undatedOrders: 0,
    bySku: [
      { sku: 'A-1', name: 'Восток', count: 2, revenue: 1000, net: 200, margin: 0.2, returns: 0 },
    ],
  };
  return {
    key: 'profit',
    period,
    title: 'Прибыль',
    periodTitle: 'за период',
    emptyText: 'Пусто.',
    empty: false,
    returned: { orders: 0, revenue: 0 },
    excluded: { orders: 0, revenue: 0, skus: [], reason: '' },
    prices: { updatedAt: null, defaultPercent: 10, overrides: [], text: '' },
    main: 'placed',
    days: { from: '2026-09-01', to: '2026-09-03' },
    placed: block,
    redeemed: block,
    cancelled: 0,
    estimate: null,
    promo: [],
    notes: { placed: '', otherOrders: '', unknownSkus: '' },
  };
}

const STOCKS = { fby: false, takenAt: null, threshold: 3, stocks: { 'A-1': 1 }, problem: null };

function dataFor(jobId: string) {
  const [kind = '', periodKey] = jobId.split('#');
  if (kind === 'stocks:by-sku') return STOCKS;
  const period = { key: periodKey || 'all', day: null };
  if (kind.startsWith('orders:')) return ordersData(kind.slice('orders:'.length), period);
  return profitData(period);
}

describe('стор главной', () => {
  it('каждый открытый источник — своя задача со своим периодом; закрытый не ставится', async () => {
    const store = useDashboardStore();
    store.load(['in_transit', 'returning'], 's1');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.start).toHaveBeenCalledWith('orders:in_transit', {}, 's1');
    expect(api.start).toHaveBeenCalledWith('orders:returning', { period: { key: 'all' } }, 's1');
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(api.http).toHaveBeenCalledWith('/profile');
  });

  it('падение одного источника не трогает остальные', async () => {
    const store = useDashboardStore();
    store.load(['in_transit', 'profit'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(store.sources.profit.error).toBe('Маркет не ответил');
    expect(store.sources.in_transit.error).toBeNull();
    expect(store.sources.in_transit.summaries?.in_transit?.value).toBe('3');
    expect(store.priceList.info).toEqual({ updatedAt: '2026-09-20T10:00:00Z' });
  });

  it('прибыль и выкупленные ставятся с общим периодом; смена периода перезапускает только их', async () => {
    api.get.mockImplementation((jobId: string) =>
      Promise.resolve({
        jobId,
        kind: 'profit:profit',
        status: 'done',
        data: dataFor(jobId),
        error: null,
        file: null,
      }),
    );
    api.start.mockImplementation((kind: string, params: { period?: { key: string } }) =>
      Promise.resolve({ jobId: `${kind}#${params.period?.key ?? ''}`, created: true }),
    );
    const store = useDashboardStore();
    const open = ['profit', 'in_transit', 'redeemed'] as const;
    store.load(open, 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.start).toHaveBeenCalledWith('profit:profit', { period: { key: 'month' } }, 's1');
    expect(api.start).toHaveBeenCalledWith('orders:redeemed', { period: { key: 'month' } }, 's1');
    expect(store.sources.profit.summaries?.net?.value).toBeDefined();
    // График читает тот же результат «Прибыли» — своей задачи у него нет.
    expect(store.sources.profit.series?.points.map((p) => p.key)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(store.sources.redeemed.series).toBeNull();

    api.start.mockClear();
    store.setPeriod('week', open, 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(api.start).toHaveBeenCalledWith('profit:profit', { period: { key: 'week' } }, 's1');
    expect(api.start).toHaveBeenCalledWith('orders:redeemed', { period: { key: 'week' } }, 's1');
    expect(store.period).toBe('week');
  });

  it('строки блока «Заказы»: выкупленные — только строкой, оформлено и отмены — из «Прибыли»', async () => {
    api.get.mockImplementation((jobId: string) =>
      Promise.resolve({
        jobId,
        kind: jobId,
        status: 'done',
        data: dataFor(jobId),
        error: null,
        file: null,
      }),
    );
    api.start.mockImplementation((kind: string, params: { period?: { key: string } }) =>
      Promise.resolve({ jobId: `${kind}#${params.period?.key ?? ''}`, created: true }),
    );
    const store = useDashboardStore();
    store.load(['profit', 'redeemed'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(store.sources.redeemed.rows?.redeemed?.count).toBe('3');
    // У «Выкуплено» карточки в ряду нет — его срез не должен лечь в чужую.
    expect(store.sources.redeemed.summaries).toEqual({});
    expect(store.sources.profit.rows?.placed?.count).toBe('2');
    expect(store.sources.profit.rows?.cancelled).toMatchObject({ count: '0', amount: null });
  });

  it('«Топ» и «На исходе»: товары из «Прибыли», остатки — своей задачей без периода', async () => {
    api.get.mockImplementation((jobId: string) =>
      Promise.resolve({
        jobId,
        kind: jobId,
        status: 'done',
        data: dataFor(jobId),
        error: null,
        file: null,
      }),
    );
    api.start.mockImplementation((kind: string, params: { period?: { key: string } }) =>
      Promise.resolve({ jobId: `${kind}#${params.period?.key ?? ''}`, created: true }),
    );
    const store = useDashboardStore();
    store.load(['profit', 'stocks'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(api.start).toHaveBeenCalledWith('stocks:by-sku', {}, 's1');
    expect(store.sources.profit.skus?.map((row) => row.sku)).toEqual(['A-1']);
    expect(store.sources.stocks.levels?.stocks).toEqual({ 'A-1': 1 });
    expect(store.sources.stocks.summaries).toEqual({});
    expect(store.sources.profit.levels).toBeNull();

    api.start.mockClear();
    store.setPeriod('week', ['profit', 'stocks'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    // Остатки — срез «сейчас»: смена периода их не перезапускает.
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it('результат со страницы с другим периодом не показывается, источник перезапускается', async () => {
    api.get.mockResolvedValueOnce({
      jobId: 'orders:returning',
      kind: 'orders:returning',
      status: 'done',
      data: ordersData('returning', { key: 'week', day: null }),
      error: null,
      file: null,
    });
    const store = useDashboardStore();
    store.load(['returning'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.sources.returning.summaries).toBeNull();
    expect(store.sources.returning.isLoading).toBe(true);
    expect(api.start).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.sources.returning.summaries?.returning?.value).toBe('3');
  });

  it('reset чистит источники, дату прайса и период', async () => {
    const store = useDashboardStore();
    store.load(['in_transit'], 's1');
    store.setPeriod('today', ['in_transit'], 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    resetAllStores();
    expect(store.sources.in_transit.summaries).toBeNull();
    expect(store.priceList.info).toBeNull();
    expect(store.period).toBe('month');
  });
});
