import type { ProfitResponse } from '../../profit.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useProfitStore } from '../store.profit';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

const BLOCK = {
  orders: 1,
  revenue: 1000,
  subsidies: 0,
  commission: 230,
  commissionPercent: 23,
  tax: 70,
  taxPercent: 7,
  promo: 0,
  purchase: 500,
  net: 200,
};

function data(overrides: Partial<ProfitResponse> = {}): ProfitResponse {
  return {
    key: 'profit',
    period: { key: 'today', day: null },
    title: 'Прибыль',
    periodTitle: 'за сегодня, 03-08-2026',
    emptyText: 'За этот период заказов нет.',
    empty: false,
    main: 'placed',
    placed: BLOCK,
    redeemed: { ...BLOCK, orders: 0 },
    cancelled: 0,
    returned: { orders: 0, revenue: 0 },
    excluded: { orders: 0, revenue: 0, skus: [], reason: 'нет закупочной цены' },
    estimate: null,
    prices: {
      updatedAt: null,
      defaultPercent: 10,
      overrides: [],
      text: 'Закупочных цен пока нет.',
    },
    promo: [],
    notes: { placed: 'едут', otherOrders: 'другие', unknownSkus: 'прайс' },
    ...overrides,
  };
}

const done = (jobId: string, payload: ProfitResponse) => ({
  jobId,
  kind: `profit:${payload.key}`,
  status: 'done',
  data: payload,
  error: null,
  file: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useProfitReport', () => {
  it('ставит задачу вкладки с периодом и отдаёт модель экрана', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data({ period: { key: 'month', day: null } })));
    const store = useProfitStore();

    store.selectPeriod({ key: 'month', day: null });
    await store.load('profit', 's1');
    expect(api.start).toHaveBeenCalledWith('profit:profit', { period: { key: 'month' } }, 's1');
    expect(store.isLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.isLoading).toBe(false);
    expect(store.report?.breakdown?.count).toBe(1);
  });

  it('калькулятор — свой kind, свой замок дедупа', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    const store = useProfitStore();
    await store.load('tariff_calc', 's1');
    expect(api.start).toHaveBeenCalledWith(
      'profit:tariff_calc',
      { period: { key: 'today' } },
      's1',
    );
  });

  it('чужой результат (старый период) не показывается и перезапускается один раз', async () => {
    api.start
      .mockResolvedValueOnce({ jobId: 'old', created: false })
      .mockResolvedValueOnce({ jobId: 'new', created: true });
    api.get
      .mockResolvedValueOnce(done('old', data({ period: { key: 'today', day: null } })))
      .mockResolvedValueOnce(done('new', data({ period: { key: 'week', day: null } })));
    const store = useProfitStore();

    store.selectPeriod({ key: 'week', day: null });
    await store.load('profit', 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report).toBeNull();
    expect(store.isLoading).toBe(true);
    expect(api.start).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report?.period).toEqual({ key: 'week', day: null });
  });

  it('ошибка задачи — текст для продавца; reset всё чистит', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue({
      jobId: 'j1',
      kind: 'profit:profit',
      status: 'failed',
      data: null,
      error: 'Яндекс.Маркет отдаёт заказы не старше 30 дней.',
      file: null,
    });
    const store = useProfitStore();
    store.selectPeriod({ key: 'all', day: null });
    await store.load('profit', 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.error).toBe('Яндекс.Маркет отдаёт заказы не старше 30 дней.');

    resetAllStores();
    expect(store.period).toEqual({ key: 'today', day: null });
    expect(store.report).toBeNull();
    expect(store.error).toBeNull();
  });
});
