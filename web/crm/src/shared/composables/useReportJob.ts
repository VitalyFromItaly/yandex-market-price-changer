import type { ComputedRef, Ref } from 'vue';

import { computed, watch } from 'vue';

import { useBaseState } from './useBaseState';
import { useJob } from './useJob';

import { cacheKey, cacheOwner, usePersistedResult } from '@/shared/cache';

export interface ReportJobSpec<TData, TRequest> {
  /** kind, params и магазин фоновой задачи для запроса. */
  launch(request: TRequest): { kind: string; params: Record<string, unknown>; store: string };
  /** Ответ относится к этому запросу (эхо периода совпало). */
  isOwn(data: TData, request: TRequest): boolean;
  /**
   * Хранить последний результат (память вкладки + localStorage) и показывать
   * его, пока собирается свежий. По умолчанию — да. `false` — у отчётов-файлов
   * по кнопке (платежи, отчёты Маркета): их результат — ссылка на задачу,
   * которая живёт на сервере сутки, и протухшая ссылка хуже пустого экрана.
   */
  persist?: boolean;
}

export interface UseReportJob<TData, TRequest> {
  request: Ref<TRequest | null>;
  /**
   * Результат — только свой; чужой (дедуп вернул прежнюю задачу) скрыт. Пока
   * свежий собирается — сохранённый для ЭТОГО же запроса (ключ несёт магазин и
   * параметры, так что чужой период или магазин сюда не попадёт).
   */
  data: ComputedRef<TData | null>;
  /** Идёт сборка — в том числе перезапуск после чужого результата. */
  isLoading: ComputedRef<boolean>;
  /** Сборка идёт, а на экране уже данные — прошлые. Скелетон не нужен, нужна полоса. */
  isRefreshing: ComputedRef<boolean>;
  /** ISO: на какой момент данные на экране; `null` — данных нет. */
  savedAt: ComputedRef<string | null>;
  /**
   * На экране свежий результат задачи, а не сохранённый. Файл скачивается по
   * номеру задачи, поэтому «Скачать xlsx» доступна только при свежем.
   */
  isFresh: ComputedRef<boolean>;
  error: Ref<string | null>;
  run(request: TRequest): Promise<void>;
  retry(): Promise<void>;
  download(fallbackName?: string): Promise<void>;
  reset(): void;
}

/**
 * Отчёт фоновой задачей CRM со сверкой эха.
 *
 * Сервер дедупит задачи по (продавец, kind, магазин): повторный запуск того же отчёта,
 * пока идёт прежний, вернёт ПРЕЖНЮЮ задачу — со старым периодом. Замок общий
 * у всех экранов (главная и страница отчёта ставят один и тот же kind), поэтому
 * ответ сверяется с запросом: чужой результат не показывается, а задача
 * перезапускается один раз — к этому моменту прежняя уже сняла замок.
 */
export function useReportJob<TData, TRequest>(
  spec: ReportJobSpec<TData, TRequest>,
): UseReportJob<TData, TRequest> {
  const [request, setRequest, , resetRequest] = useBaseState<TRequest | null>(null);
  const job = useJob<TData>();
  let restarted = false;

  const persisted = usePersistedResult<TData>(() => {
    const current = request.value;
    if (spec.persist === false || current === null) return null;
    const { kind, params, store } = spec.launch(current);
    return cacheKey(cacheOwner(), { kind, store, params });
  });

  function launch(current: TRequest): Promise<void> {
    const { kind, params, store } = spec.launch(current);
    return job.start(kind, params, store);
  }

  async function run(next: TRequest): Promise<void> {
    setRequest(next);
    restarted = false;
    await launch(next);
  }

  watch(
    () => job.job.value,
    (view) => {
      const current = request.value;
      if (view?.status !== 'done' || view.data === null || current === null) return;
      if (spec.isOwn(view.data, current) || restarted) return;
      restarted = true;
      void launch(current);
    },
  );

  const fresh = computed<TData | null>(() => {
    const view = job.job.value;
    const current = request.value;
    if (view?.status !== 'done' || view.data === null || current === null) return null;
    return spec.isOwn(view.data, current) ? view.data : null;
  });

  // Свой свежий результат — сразу в кэш: следующий заход покажет его без ожидания.
  watch(fresh, (value) => {
    if (value !== null && spec.persist !== false) persisted.save(value);
  });

  const data = computed<TData | null>(() => fresh.value ?? persisted.entry.value?.data ?? null);

  const isLoading = computed(
    () =>
      job.isRunning.value || (job.isDone.value && fresh.value === null && job.error.value === null),
  );

  const isRefreshing = computed(() => isLoading.value && data.value !== null);

  const savedAt = computed(() =>
    data.value === null ? null : (persisted.entry.value?.savedAt ?? null),
  );

  async function retry(): Promise<void> {
    if (request.value !== null) await run(request.value);
  }

  function reset(): void {
    job.reset();
    resetRequest();
    restarted = false;
  }

  return {
    request,
    data,
    isLoading,
    isRefreshing,
    savedAt,
    isFresh: computed(() => fresh.value !== null),
    error: job.error,
    run,
    retry,
    download: job.download,
    reset,
  };
}
