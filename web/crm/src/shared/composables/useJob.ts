import type { JobView } from '@/shared/jobs';
import type { ComputedRef, Ref } from 'vue';

import { computed, getCurrentScope, onScopeDispose } from 'vue';

import { useBaseState } from './useBaseState';

import { ApiError, NETWORK_ERROR_STATUS } from '@/shared/http';
import { isFinished, jobsApi, saveFile } from '@/shared/jobs';

/** Первый опрос — через секунду: быстрые отчёты успевают, долгие не долбят сервер. */
export const FIRST_POLL_MS = 1_000;
export const POLL_FACTOR = 1.5;
export const MAX_POLL_MS = 10_000;
/**
 * Сколько сетевых сбоев подряд терпим. Отчёт идёт минутами, и один моргнувший
 * Wi-Fi не должен превращать его в ошибку — задача на сервере всё равно идёт.
 */
export const MAX_NETWORK_FAILURES = 3;

export function nextPollDelay(delay: number): number {
  return Math.min(Math.round(delay * POLL_FACTOR), MAX_POLL_MS);
}

export interface UseJob<TData> {
  job: Ref<JobView<TData> | null>;
  /** Задача поставлена и ещё не завершилась (или ещё ставится). */
  isRunning: Ref<boolean>;
  /** Текст для продавца: причина failed или сбой запроса. */
  error: Ref<string | null>;
  isDone: ComputedRef<boolean>;
  /** `store` — ключ открытого магазина; отчёты CRM без него сервер не ставит. */
  start(kind: string, params?: Record<string, unknown>, store?: string): Promise<void>;
  /**
   * Опрашивать задачу, созданную не через /ym/jobs (загрузка прайса ставит её
   * своим POST с файлом). Тот же опрос, что у `start`, — второй копии нет.
   */
  track(jobId: string): void;
  /** Перестать опрашивать. Задача на сервере продолжается — её можно подхватить позже. */
  cancel(): void;
  download(fallbackName?: string): Promise<void>;
  reset(): void;
}

/**
 * Фоновая задача CRM глазами страницы: поставить → опрашивать с backoff →
 * отдать данные или файл. Опрос живёт не дольше области, в которой создан:
 * уход со страницы останавливает таймер (`onScopeDispose`), иначе
 * размонтированный экран продолжал бы ходить в API.
 */
export function useJob<TData = unknown>(): UseJob<TData> {
  const [job, setJob, isRunning, resetJob] = useBaseState<JobView<TData> | null>(null);
  const [error, setError, , resetError] = useBaseState<string | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  // Номер запуска: ответ опроса, пришедший после cancel/start, выбрасывается.
  let generation = 0;

  function stopTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function cancel(): void {
    generation += 1;
    stopTimer();
    isRunning.value = false;
  }

  function fail(message: string): void {
    setError(message);
    isRunning.value = false;
  }

  function schedule(jobId: string, delay: number, failures: number, run: number): void {
    timer = setTimeout(() => {
      timer = null;
      void poll(jobId, delay, failures, run);
    }, delay);
  }

  async function poll(jobId: string, delay: number, failures: number, run: number): Promise<void> {
    try {
      const view = await jobsApi.get<TData>(jobId);
      if (run !== generation) return;
      setJob(view);
      if (!isFinished(view.status)) {
        schedule(jobId, nextPollDelay(delay), 0, run);
        return;
      }
      isRunning.value = false;
      if (view.status === 'failed') setError(view.error ?? 'Не удалось собрать отчёт.');
    } catch (caught) {
      if (run !== generation) return;
      const isNetwork = caught instanceof ApiError && caught.status === NETWORK_ERROR_STATUS;
      if (isNetwork && failures + 1 < MAX_NETWORK_FAILURES) {
        schedule(jobId, nextPollDelay(delay), failures + 1, run);
        return;
      }
      fail(caught instanceof Error ? caught.message : 'Не удалось узнать статус отчёта.');
    }
  }

  /** Новый запуск: прежний опрос гасится, состояние чистится. Отдаёт его номер. */
  function begin(): number {
    cancel();
    resetJob();
    resetError();
    isRunning.value = true;
    return generation;
  }

  async function start(
    kind: string,
    params: Record<string, unknown> = {},
    store?: string,
  ): Promise<void> {
    const run = begin();
    try {
      const { jobId } = await jobsApi.start(kind, params, store);
      if (run !== generation) return;
      schedule(jobId, FIRST_POLL_MS, 0, run);
    } catch (caught) {
      if (run !== generation) return;
      fail(caught instanceof Error ? caught.message : 'Не удалось запустить отчёт.');
    }
  }

  function track(jobId: string): void {
    schedule(jobId, FIRST_POLL_MS, 0, begin());
  }

  async function download(fallbackName = 'report.xlsx'): Promise<void> {
    const current = job.value;
    if (current?.status !== 'done' || current.file === null) return;
    try {
      saveFile(await jobsApi.file(current.jobId), current.file.filename || fallbackName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось скачать файл.');
    }
  }

  function reset(): void {
    cancel();
    resetJob();
    resetError();
  }

  if (getCurrentScope()) onScopeDispose(cancel);

  const isDone = computed(() => job.value?.status === 'done');

  return { job, isRunning, error, isDone, start, track, cancel, download, reset };
}
