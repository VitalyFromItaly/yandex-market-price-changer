import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { FIRST_POLL_MS } from './useJob';
import { useReportJob } from './useReportJob';

import { cacheKey, clearReportCache, setCacheOwner } from '@/shared/cache';

const api = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), file: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

interface Data {
  period: string;
}

const done = (jobId: string, period: string) => ({
  jobId,
  kind: 'k',
  status: 'done',
  data: { period },
  error: null,
  file: null,
});

function setup() {
  const scope = effectScope();
  const job = scope.run(() =>
    useReportJob<Data, string>({
      launch: (period) => ({ kind: 'k', params: { period }, store: 's1' }),
      isOwn: (data, period) => data.period === period,
    }),
  );
  if (!job) throw new Error('scope');
  return { job, scope };
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(api)) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useReportJob', () => {
  it('свой результат отдаётся, запуск — с params запроса', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', 'week'));
    const { job } = setup();

    await job.run('week');
    expect(api.start).toHaveBeenCalledWith('k', { period: 'week' }, 's1');
    expect(job.isLoading.value).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(job.data.value).toEqual({ period: 'week' });
    expect(job.isLoading.value).toBe(false);
  });

  it('чужое эхо не показывается и перезапускается ровно один раз', async () => {
    api.start
      .mockResolvedValueOnce({ jobId: 'old', created: false })
      .mockResolvedValue({ jobId: 'again', created: false });
    api.get.mockResolvedValue(done('old', 'today'));
    const { job } = setup();

    await job.run('month');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(job.data.value).toBeNull();
    expect(api.start).toHaveBeenCalledTimes(2);

    // Второй раз опять чужое — больше не перезапускаем, чтобы не крутиться.
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(job.data.value).toBeNull();
  });

  it('ошибка — текстом; retry ставит тот же запрос заново; reset чистит', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue({
      ...done('j1', 'week'),
      status: 'failed',
      data: null,
      error: 'Сбой',
    });
    const { job } = setup();

    await job.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(job.error.value).toBe('Сбой');
    expect(job.isLoading.value).toBe(false);

    await job.retry();
    expect(api.start).toHaveBeenLastCalledWith('k', { period: 'week' }, 's1');

    job.reset();
    expect(job.request.value).toBeNull();
    expect(job.error.value).toBeNull();
  });
});

describe('useReportJob: прошлые данные, пока собираются свежие', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    });
    setCacheOwner(() => 'u1');
  });

  afterEach(() => {
    clearReportCache();
    setCacheOwner(() => null);
    vi.unstubAllGlobals();
  });

  it('повторный запуск держит прежние данные: полоса, а не скелетон; скачать — только свежее', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', 'week'));
    const { job } = setup();
    await job.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(job.isFresh.value).toBe(true);

    await job.run('week');
    expect(job.data.value).toEqual({ period: 'week' });
    expect(job.isRefreshing.value).toBe(true);
    expect(job.isFresh.value).toBe(false);
    expect(job.savedAt.value).not.toBeNull();

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(job.isRefreshing.value).toBe(false);
    expect(job.isFresh.value).toBe(true);
  });

  it('данные другого периода не показываются под новым', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', 'week'));
    const { job } = setup();
    await job.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    await job.run('month');
    expect(job.data.value).toBeNull();
    expect(job.isRefreshing.value).toBe(false);
  });

  it('после перезагрузки данные берутся из localStorage до первого ответа', async () => {
    const key = cacheKey('u1', { kind: 'k', store: 's1', params: { period: 'week' } });
    if (key === null) throw new Error('key');
    store.set(key, JSON.stringify({ savedAt: new Date().toISOString(), data: { period: 'week' } }));
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', 'week'));
    const { job } = setup();

    await job.run('week');
    expect(job.data.value).toEqual({ period: 'week' });
    expect(job.isRefreshing.value).toBe(true);
  });

  it('сбой обновления не стирает показанные данные', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValueOnce(done('j1', 'week'));
    const { job } = setup();
    await job.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    api.get.mockResolvedValue({
      ...done('j1', 'week'),
      status: 'failed',
      data: null,
      error: 'сбой',
    });
    await job.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(job.error.value).toBe('сбой');
    expect(job.data.value).toEqual({ period: 'week' });
  });

  it('без владельца (сессия не загружена) и с persist: false — кэша нет', async () => {
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
    api.get.mockResolvedValue(done('j1', 'week'));
    const scope = effectScope();
    const off = scope.run(() =>
      useReportJob<Data, string>({
        launch: (period) => ({ kind: 'k', params: { period }, store: 's1' }),
        isOwn: (data, period) => data.period === period,
        persist: false,
      }),
    );
    if (!off) throw new Error('scope');
    await off.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await off.run('week');
    expect(off.data.value).toBeNull();
    expect(store.size).toBe(0);

    setCacheOwner(() => null);
    const { job } = setup();
    await job.run('week');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    await job.run('week');
    expect(job.data.value).toBeNull();
  });
});
