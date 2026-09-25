import type { JobView } from '@/shared/jobs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { FIRST_POLL_MS, MAX_POLL_MS, nextPollDelay, useJob } from './useJob';

import { ApiError, NETWORK_ERROR_STATUS } from '@/shared/http';

const api = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  file: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('@/shared/jobs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  jobsApi: { start: api.start, get: api.get, file: api.file },
  saveFile: api.saveFile,
}));

function view(status: JobView['status'], extra: Partial<JobView> = {}): JobView {
  return { jobId: 'j1', kind: 'k', status, data: null, error: null, file: null, ...extra };
}

/** Дождаться промисов, запущенных таймером. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('useJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.start.mockResolvedValue({ jobId: 'j1', created: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('backoff: 1 с → ×1.5 → потолок 10 с', () => {
    expect(nextPollDelay(FIRST_POLL_MS)).toBe(1_500);
    expect(nextPollDelay(1_500)).toBe(2_250);
    expect(nextPollDelay(9_000)).toBe(MAX_POLL_MS);
    expect(nextPollDelay(MAX_POLL_MS)).toBe(MAX_POLL_MS);
  });

  it('опрашивает с растущей паузой до done', async () => {
    api.get
      .mockResolvedValueOnce(view('queued'))
      .mockResolvedValueOnce(view('active'))
      .mockResolvedValueOnce(view('done', { data: { rows: 3 } }));
    const job = useJob<{ rows: number }>();

    await job.start('test', { period: 'month' });
    expect(api.start).toHaveBeenCalledWith('test', { period: 'month' }, undefined);
    expect(job.isRunning.value).toBe(true);
    expect(api.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(job.job.value?.status).toBe('queued');

    // Вторая пауза длиннее первой: через 1 с опроса ещё нет.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(api.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_250);
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(job.isDone.value).toBe(true);
    expect(job.isRunning.value).toBe(false);
    expect(job.job.value?.data).toEqual({ rows: 3 });

    // После завершения опрос остановлен.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('failed — текст причины от сервера, опрос остановлен', async () => {
    api.get.mockResolvedValue(view('failed', { error: 'За период нет данных' }));
    const job = useJob();
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(job.error.value).toBe('За период нет данных');
    expect(job.isRunning.value).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('уход со страницы (dispose области) останавливает опрос', async () => {
    api.get.mockResolvedValue(view('active'));
    const scope = effectScope();
    const job = scope.run(() => useJob());
    if (job === undefined) throw new Error('область не запустилась');
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);
    expect(api.get).toHaveBeenCalledTimes(1);

    scope.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(job.isRunning.value).toBe(false);
  });

  it('ответ, пришедший после cancel, выбрасывается', async () => {
    let resolve: (value: JobView) => void = () => undefined;
    api.get.mockReturnValue(new Promise<JobView>((r) => (resolve = r)));
    const job = useJob();
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    job.cancel();
    resolve(view('done'));
    await flush();
    expect(job.job.value).toBeNull();
  });

  it('сетевой сбой терпится, пока не наберётся три подряд', async () => {
    const offline = new ApiError('Нет связи с сервером', NETWORK_ERROR_STATUS);
    api.get
      .mockRejectedValueOnce(offline)
      .mockRejectedValueOnce(offline)
      .mockResolvedValueOnce(view('done'));
    const job = useJob();
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS + 1_500 + 2_250);

    expect(api.get).toHaveBeenCalledTimes(3);
    expect(job.isDone.value).toBe(true);
    expect(job.error.value).toBeNull();
  });

  it('три сетевых сбоя подряд — ошибка и стоп', async () => {
    api.get.mockRejectedValue(new ApiError('Нет связи с сервером', NETWORK_ERROR_STATUS));
    const job = useJob();
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS + 1_500 + 2_250);

    expect(job.error.value).toBe('Нет связи с сервером');
    expect(job.isRunning.value).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('404 (задача удалена по TTL) — сразу ошибка, без повторов', async () => {
    api.get.mockRejectedValue(new ApiError('Задача не найдена или уже удалена', 404));
    const job = useJob();
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(job.error.value).toBe('Задача не найдена или уже удалена');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('отказ постановки (403 фичи) — ошибка без опроса', async () => {
    api.start.mockRejectedValue(new ApiError('Функция отключена', 403, 'FEATURE_DISABLED'));
    const job = useJob();
    await job.start('test');

    expect(job.error.value).toBe('Функция отключена');
    expect(job.isRunning.value).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('download отдаёт файл готовой задачи; reset всё обнуляет', async () => {
    api.get.mockResolvedValue(view('done', { file: { filename: 'отчёт.xlsx' } }));
    const file = { blob: new Blob(['PK']), filename: 'отчёт.xlsx' };
    api.file.mockResolvedValue(file);
    const job = useJob();
    await job.start('test');
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    await job.download();
    expect(api.file).toHaveBeenCalledWith('j1');
    expect(api.saveFile).toHaveBeenCalledWith(file, 'отчёт.xlsx');

    job.reset();
    expect(job.job.value).toBeNull();
    expect(job.error.value).toBeNull();
    expect(job.isRunning.value).toBe(false);
  });

  it('track опрашивает уже созданную задачу, не ставя новую', async () => {
    api.get.mockResolvedValueOnce(view('done', { jobId: 'upl', data: { rows: 1 } }));
    const job = useJob<{ rows: number }>();

    job.track('upl');
    expect(job.isRunning.value).toBe(true);
    await vi.advanceTimersByTimeAsync(FIRST_POLL_MS);

    expect(api.start).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith('upl');
    expect(job.isDone.value).toBe(true);
    expect(job.isRunning.value).toBe(false);
  });
});
