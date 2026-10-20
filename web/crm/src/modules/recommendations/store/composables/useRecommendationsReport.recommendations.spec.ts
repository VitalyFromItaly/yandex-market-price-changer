import type { RecommendationsResponse } from '../../recommendations.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useRecommendationsStore } from '../store.recommendations';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

function data(overrides: Partial<RecommendationsResponse> = {}): RecommendationsResponse {
  return {
    takenAt: '24-09-2026 10:05',
    count: 1,
    average: 1,
    low: 0,
    other: 0,
    emptyText: null,
    rows: [
      {
        offerId: 'A',
        price: 1100,
        optimalPrice: 1000,
        averagePrice: null,
        competitiveness: 'AVERAGE',
        competitivenessLabel: 'умеренная',
        shows: null,
        deltaAbs: 100,
        deltaPercent: 10,
      },
    ],
    file: { filename: 'rekomendacii-cen-24-09-2026-1005.xlsx', rows: 1, truncated: 0 },
    ...overrides,
  };
}

const done = (jobId: string, payload: RecommendationsResponse) => ({
  jobId,
  kind: 'recommendations:report',
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

describe('useRecommendationsReport', () => {
  it('ставит задачу без параметров и отдаёт модель экрана', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useRecommendationsStore();

    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledWith('recommendations:report', {}, 's1');
    expect(store.isLoading).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report?.heading).toBe('на 24-09-2026 10:05 МСК');
    expect(store.report?.rows[0]).toMatchObject({ offerId: 'A', id: 'A:0' });
  });

  it('каждый вход пересобирает срез, идущую сборку не дублирует; «Обновить» — тоже', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useRecommendationsStore();

    await store.ensure('s1');
    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledTimes(2);

    await store.refresh('s1');
    expect(api.start).toHaveBeenCalledTimes(3);

    await store.ensure('s2');
    expect(api.start).toHaveBeenLastCalledWith('recommendations:report', {}, 's2');
  });

  it('пустой срез — модель с текстом, не вечная загрузка', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(
      done('j1', data({ count: 0, rows: [], file: null, emptyText: 'Все цены привлекательные' })),
    );
    const store = useRecommendationsStore();

    await store.ensure('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.isLoading).toBe(false);
    expect(store.report?.emptyText).toBe('Все цены привлекательные');
  });

  it('ошибка задачи — текстом; reset чистит', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue({
      ...done('j1', data()),
      status: 'failed',
      data: null,
      error: 'Сбой',
    });
    const store = useRecommendationsStore();

    await store.ensure('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.error).toBe('Сбой');

    store.reset();
    expect(store.error).toBeNull();
    expect(store.report).toBeNull();
  });
});
