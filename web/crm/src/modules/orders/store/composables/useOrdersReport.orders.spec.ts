import type { OrdersReportResponse } from '../../orders.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useOrdersStore } from '../store.orders';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

function data(overrides: Partial<OrdersReportResponse> = {}): OrdersReportResponse {
  return {
    key: 'redeemed',
    title: 'Выкуплено',
    count: 1,
    totals: { sales: 100, subsidies: 0, withDelivery: 100 },
    period: { key: 'today', day: null },
    periodTitle: 'за сегодня, 03-08-2026',
    takenAt: null,
    assembling: null,
    returns: null,
    notes: [],
    emptyText: 'За этот период данных нет.',
    rows: [],
    file: { filename: 'vykupleno-03-08-2026-1000.xlsx', rows: 1, truncated: 0 },
    ...overrides,
  };
}

const done = (jobId: string, payload: OrdersReportResponse) => ({
  jobId,
  kind: `orders:${payload.key}`,
  status: 'done',
  data: payload,
  error: null,
  file: payload.file ? { filename: payload.file.filename } : null,
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

describe('useOrdersReport', () => {
  it('ставит задачу своего отчёта с периодом и отдаёт модель экрана', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useOrdersStore();

    store.selectPeriod({ key: 'month', day: null });
    api.get.mockResolvedValue(done('j1', data({ period: { key: 'month', day: null } })));
    await store.load('redeemed', 's1');
    expect(api.start).toHaveBeenCalledWith('orders:redeemed', { period: { key: 'month' } }, 's1');
    expect(store.isLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.isLoading).toBe(false);
    expect(store.report?.count).toBe(1);
    expect(store.report?.file?.filename).toBe('vykupleno-03-08-2026-1000.xlsx');
  });

  it('«Едет до клиента» уходит без периода', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    const store = useOrdersStore();
    await store.load('in_transit', 's1');
    expect(api.start).toHaveBeenCalledWith('orders:in_transit', {}, 's1');
  });

  it('чужой результат (дедуп по kind вернул старую задачу) не показывается и перезапускается', async () => {
    api.start
      .mockResolvedValueOnce({ jobId: 'old', created: false })
      .mockResolvedValueOnce({ jobId: 'new', created: true });
    api.get
      .mockResolvedValueOnce(done('old', data({ period: { key: 'today', day: null } })))
      .mockResolvedValueOnce(done('new', data({ period: { key: 'week', day: null } })));
    const store = useOrdersStore();

    store.selectPeriod({ key: 'week', day: null });
    await store.load('redeemed', 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report).toBeNull();
    expect(store.isLoading).toBe(true);
    expect(api.start).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report?.period).toEqual({ key: 'week', day: null });
  });

  it('ошибка задачи — текст для продавца; retry ставит заново', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue({
      jobId: 'j1',
      kind: 'orders:redeemed',
      status: 'failed',
      data: null,
      error: 'Яндекс.Маркет отдаёт заказы не старше 30 дней.',
      file: null,
    });
    const store = useOrdersStore();
    await store.load('redeemed', 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.error).toBe('Яндекс.Маркет отдаёт заказы не старше 30 дней.');
    expect(store.isLoading).toBe(false);

    await store.retry();
    expect(api.start).toHaveBeenCalledTimes(2);
  });

  it('reset возвращает период и результат к начальным', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useOrdersStore();
    store.selectPeriod({ key: 'all', day: null });
    await store.load('redeemed', 's1');

    resetAllStores();
    expect(store.period).toEqual({ key: 'today', day: null });
    expect(store.report).toBeNull();
    expect(store.error).toBeNull();
  });
});
