import type { FbyResponse } from '../../fby.domain';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useFbyStore } from '../store.fby';

import { FIRST_POLL_MS } from '@/shared/composables';
import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

function data(overrides: Partial<FbyResponse> = {}): FbyResponse {
  return {
    takenAt: '24-09-2026 10:05',
    stockTakenAt: null,
    stockTypes: [{ type: 'AVAILABLE', label: 'доступно' }],
    stockHint: '',
    stockProblem: 'Остатки обновляются, попробуйте через минуту.',
    stock: null,
    requests: null,
    requestsProblem: 'Заявки временно недоступны.',
    supplies: { state: 'error', text: 'Поставки временно недоступны.' },
    inTransit: 5,
    returning: 1,
    file: null,
    ...overrides,
  };
}

const done = (jobId: string, payload: FbyResponse) => ({
  jobId,
  kind: 'fby:overview',
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

describe('useFbyReport', () => {
  it('ставит задачу без параметров; сбойные блоки не делают отчёт пустым', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useFbyStore();

    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledWith('fby:overview', {}, 's1');

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.isLoading).toBe(false);
    expect(store.report).toMatchObject({ heading: 'на 24-09-2026 10:05 МСК', inTransit: 5 });
    expect(store.report?.stock).toBeNull();
  });

  it('каждый вход ставит задачу, идущую не дублирует; «Обновить» и другой магазин — ставят', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data()));
    const store = useFbyStore();

    await store.ensure('s1');
    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await store.ensure('s1');
    expect(api.start).toHaveBeenCalledTimes(2);

    await store.refresh('s1');
    expect(api.start).toHaveBeenCalledTimes(3);
    await store.ensure('s2');
    expect(api.start).toHaveBeenLastCalledWith('fby:overview', {}, 's2');
  });

  it('скачивание — файлом задачи с именем из ответа', async () => {
    const file = { filename: 'fby-ostatki-24-09-2026-1005.xlsx', rows: 1, truncated: 0 };
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', data({ file })));
    api.file.mockResolvedValue({ blob: new Blob(), filename: '' });
    const store = useFbyStore();

    await store.ensure('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await store.download();
    expect(api.file).toHaveBeenCalledWith('j1');
    expect(api.saveFile.mock.calls[0]?.[1]).toBe(file.filename);
  });

  it('ошибка — текстом; reset чистит', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue({
      ...done('j1', data()),
      status: 'failed',
      data: null,
      error: 'Сбой',
    });
    const store = useFbyStore();

    await store.ensure('s1');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(store.error).toBe('Сбой');

    store.reset();
    expect(store.error).toBeNull();
    expect(store.report).toBeNull();
  });
});
