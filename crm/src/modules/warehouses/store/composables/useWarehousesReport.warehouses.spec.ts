import type { WarehousesResponse } from '../../warehouses.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useWarehousesStore } from '../store.warehouses';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

function data(overrides: Partial<WarehousesResponse> = {}): WarehousesResponse {
  return {
    takenAt: '24-09-2026 10:05',
    stockTakenAt: null,
    stockTypes: [],
    stockProblem: null,
    fbyHint: '',
    storeHint: '',
    notInListLabel: '',
    fby: [],
    sum: null,
    store: [],
    emptyText: 'У этого магазина не найдено ни одного склада.',
    ...overrides,
  };
}

const done = (jobId: string, payload: WarehousesResponse) => ({
  jobId,
  kind: 'warehouses:overview',
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

describe('useWarehousesReport', () => {
  it('пустой срез завершает загрузку с emptyText', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useWarehousesStore();

    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledWith('warehouses:overview', {}, 's1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(store.isLoading).toBe(false);
    expect(store.report?.emptyText).toBe('У этого магазина не найдено ни одного склада.');
  });

  it('каждый вход ставит задачу, идущую не дублирует; «Обновить» — ставит; reset чистит', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useWarehousesStore();

    await store.ensure('s1');
    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledTimes(2);
    await store.refresh('s1');
    expect(api.start).toHaveBeenCalledTimes(3);

    store.reset();
    expect(store.report).toBeNull();
  });
});
