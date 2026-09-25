import type { MarketReportResponse } from '../market-reports.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useMarketReportsStore } from './store.market-reports';

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

const OPTIONS = {
  reports: [
    { key: 'key', title: 'Ключевые показатели', hourlyLimit: null },
    { key: 'comp', title: 'Конкурентная позиция', hourlyLimit: 10 },
  ],
  periods: [{ key: 'month', label: 'С 1 числа месяца' }],
  months: [],
  groupings: [],
  detalizations: [
    { key: 'WEEK', label: 'По неделям' },
    { key: 'MONTH', label: 'По месяцам' },
  ],
};

function data(overrides: Partial<MarketReportResponse> = {}): MarketReportResponse {
  return {
    key: 'key',
    params: { detalizationLevel: 'MONTH' },
    empty: false,
    emptyText: null,
    filename: 'otchet-key.xlsx',
    ...overrides,
  };
}

const done = (jobId: string, payload: MarketReportResponse) => ({
  jobId,
  kind: `market-reports:${payload.key}`,
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

describe('useMarketReportsStore', () => {
  it('варианты — по магазину: тот же магазин не перезапрашивается, другой — да', async () => {
    http.get.mockResolvedValue(OPTIONS);
    const store = useMarketReportsStore();

    await store.loadOptions('s1');
    await store.loadOptions('s1');
    await store.loadOptions('s2');

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenCalledWith('/ym/market-reports/options?store=s1');
    expect(store.options?.reports.map((r) => r.key)).toEqual(['key', 'comp']);
  });

  it('«Ключевые показатели» MONTH: задача с эхом параметров, готовый файл', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useMarketReportsStore();

    store.setField('detalization', 'MONTH');
    await store.generate('key', 's1');
    expect(api.start).toHaveBeenCalledWith(
      'market-reports:key',
      { detalizationLevel: 'MONTH' },
      's1',
    );
    expect(store.isLoadingOf('key')).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.isLoadingOf('key')).toBe(false);
    expect(store.reportOf('key')).toEqual({
      key: 'key',
      emptyText: null,
      filename: 'otchet-key.xlsx',
    });
  });

  it('чужое эхо параметров (дедуп вернул задачу с WEEK) не показывается', async () => {
    api.start
      .mockResolvedValueOnce({ jobId: 'old', created: false })
      .mockResolvedValueOnce({ jobId: 'j2', created: true });
    api.get
      .mockResolvedValueOnce(done('old', data({ params: { detalizationLevel: 'WEEK' } })))
      .mockResolvedValue(done('j2', data()));
    const store = useMarketReportsStore();

    store.setField('detalization', 'MONTH');
    await store.generate('key', 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.reportOf('key')).toBeNull();

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.reportOf('key')?.filename).toBe('otchet-key.xlsx');
  });

  it('незаполненная форма (нет категории) — задача не ставится', async () => {
    const store = useMarketReportsStore();
    store.setField('period', 'month');
    await store.generate('comp', 's1');
    expect(api.start).not.toHaveBeenCalled();
  });

  it('у каждого отчёта своя задача: заказ одного не стирает другой', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useMarketReportsStore();

    store.setField('detalization', 'MONTH');
    await store.generate('key', 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(store.requestedParams('geo')).toBeNull();
    expect(store.reportOf('key')?.filename).toBe('otchet-key.xlsx');
  });

  it('initForm не затирает выбор продавца', () => {
    const store = useMarketReportsStore();
    store.setField('detalization', 'MONTH');
    store.initForm({
      period: 'week',
      month: null,
      categoryId: null,
      grouping: null,
      detalization: 'WEEK',
    });
    expect(store.form.detalization).toBe('MONTH');
  });

  it('категории грузятся по требованию, ошибка — текстом', async () => {
    http.get.mockRejectedValue(new Error('Не удалось получить категории каталога.'));
    const store = useMarketReportsStore();

    await store.loadCategories('s1');

    expect(http.get).toHaveBeenCalledWith('/ym/market-reports/categories?store=s1');
    expect(store.categoriesError).toBe('Не удалось получить категории каталога.');
    expect(store.categoriesLoading).toBe(false);
  });

  it('reset чистит варианты, форму и задачи', async () => {
    http.get.mockResolvedValue(OPTIONS);
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    const store = useMarketReportsStore();
    await store.loadOptions('s1');
    store.setField('detalization', 'MONTH');
    await store.generate('key', 's1');

    resetAllStores();

    expect(store.options).toBeNull();
    expect(store.form.detalization).toBeNull();
    expect(store.requestedParams('key')).toBeNull();
  });
});
