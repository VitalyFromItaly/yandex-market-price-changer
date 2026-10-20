import type { PaymentsReportResponse } from '../payments.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { usePaymentsStore } from './store.payments';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/http', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  http: { get: http.get },
}));

function data(overrides: Partial<PaymentsReportResponse> = {}): PaymentsReportResponse {
  return {
    period: 'prevmonth',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    empty: false,
    emptyText: null,
    filename: 'platezhi-01-07-2026-31-07-2026-1000.xlsx',
    ...overrides,
  };
}

const done = (jobId: string, payload: PaymentsReportResponse) => ({
  jobId,
  kind: 'payments:report',
  status: 'done',
  data: payload,
  error: null,
  file: payload.filename ? { filename: payload.filename } : null,
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [...Object.values(api), http.get]) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePaymentsStore', () => {
  it('варианты периода грузятся один раз', async () => {
    http.get.mockResolvedValue({ periods: [{ key: 'week', label: 'Последние 7 дней' }] });
    const store = usePaymentsStore();

    await store.loadOptions();
    await store.loadOptions();

    expect(http.get).toHaveBeenCalledOnce();
    expect(http.get).toHaveBeenCalledWith('/ym/payments/options');
    expect(store.options?.periods).toEqual([{ value: 'week', label: 'Последние 7 дней' }]);
  });

  it('без выбранного периода отчёт не заказывается', async () => {
    const store = usePaymentsStore();
    await store.generate('s1');
    expect(api.start).not.toHaveBeenCalled();
    expect(store.requested).toBe(false);
  });

  it('ставит задачу с ключом периода — без дат — и отдаёт готовый файл', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = usePaymentsStore();

    store.selectPeriod('prevmonth');
    await store.generate('s1');
    expect(api.start).toHaveBeenCalledWith('payments:report', { period: 'prevmonth' }, 's1');
    expect(store.isLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.isLoading).toBe(false);
    expect(store.report).toEqual({
      period: 'prevmonth',
      caption: '01-07-2026 — 31-07-2026',
      emptyText: null,
      filename: 'platezhi-01-07-2026-31-07-2026-1000.xlsx',
    });
  });

  it('чужое эхо периода не показывается — задача перезапускается', async () => {
    api.start
      .mockResolvedValueOnce({ jobId: 'old', created: false })
      .mockResolvedValueOnce({ jobId: 'j2', created: true });
    api.get
      .mockResolvedValueOnce(done('old', data({ period: 'week' })))
      .mockResolvedValue(done('j2', data()));
    const store = usePaymentsStore();

    store.selectPeriod('prevmonth');
    await store.generate('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report).toBeNull();
    expect(api.start).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report?.period).toBe('prevmonth');
  });

  it('«данных нет» — модель с текстом, не ошибка', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(
      done('j1', data({ empty: true, emptyText: 'Платежей нет.', filename: null })),
    );
    const store = usePaymentsStore();

    store.selectPeriod('prevmonth');
    await store.generate('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(store.error).toBeNull();
    expect(store.report?.emptyText).toBe('Платежей нет.');
  });

  it('reset чистит период, варианты и отчёт', async () => {
    http.get.mockResolvedValue({ periods: [] });
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    const store = usePaymentsStore();
    await store.loadOptions();
    store.selectPeriod('week');
    await store.generate('s1');

    resetAllStores();

    expect(store.period).toBeNull();
    expect(store.options).toBeNull();
    expect(store.requested).toBe(false);
  });
});
