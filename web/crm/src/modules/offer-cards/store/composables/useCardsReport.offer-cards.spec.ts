import type { CardsResponse } from '../../offer-cards.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useOfferCardsStore } from '../store.offer-cards';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

function data(overrides: Partial<CardsResponse> = {}): CardsResponse {
  return {
    takenAt: '24-09-2026 10:05',
    summary: {
      totalCards: 1,
      byStatus: [{ status: 'NO_CARD_ERRORS', label: 'Ошибки', actionable: true, count: 1 }],
      averageRating: 40,
      averageBenchmark: 70,
    },
    emptyText: null,
    rows: [
      {
        offerId: 'A',
        status: 'NO_CARD_ERRORS',
        statusLabel: 'Ошибки',
        actionable: true,
        contentRating: 40,
        averageContentRating: 70,
        recommendations: [],
        errorsCount: 1,
        warningsCount: 0,
      },
    ],
    file: { filename: 'kartochki-24-09-2026-1005.xlsx', rows: 1, truncated: 0 },
    ...overrides,
  };
}

const done = (jobId: string, payload: CardsResponse) => ({
  jobId,
  kind: 'cards:report',
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

describe('useCardsReport', () => {
  it('ставит задачу без параметров и отдаёт сводку и строки', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useOfferCardsStore();

    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledWith('cards:report', {}, 's1');

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.report).toMatchObject({
      heading: 'на 24-09-2026 10:05 МСК',
      totalCards: 1,
      averageRating: 40,
    });
    expect(store.report?.rows[0]?.id).toBe('A:0');
  });

  it('скачивание — файлом задачи с именем из ответа', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    api.file.mockResolvedValue({ blob: new Blob(), filename: '' });
    const store = useOfferCardsStore();

    await store.ensure('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await store.download();
    expect(api.file).toHaveBeenCalledWith('j1');
    expect(api.saveFile.mock.calls[0]?.[1]).toBe('kartochki-24-09-2026-1005.xlsx');
  });

  it('ошибка — текстом; reset чистит', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue({
      ...done('j1', data()),
      status: 'failed',
      data: null,
      error: 'Сбой',
    });
    const store = useOfferCardsStore();

    await store.ensure('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.error).toBe('Сбой');

    store.reset();
    expect(store.error).toBeNull();
    expect(store.report).toBeNull();
  });
});
