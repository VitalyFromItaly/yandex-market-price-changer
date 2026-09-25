import type {
  MarketReport,
  MarketReportForm,
  MarketReportKey,
  MarketReportParams,
  MarketReportResponse,
} from '../../market-reports.domain';

import {
  mapMarketReport,
  marketParams,
  sameParams,
} from '../../mappers/mapMarketReports.market-reports';
import { marketReportJobKind } from '../../market-reports.domain';

import { useBaseState, useReportJob } from '@/shared/composables';

interface Request {
  key: MarketReportKey;
  params: MarketReportParams;
  /** Ключ открытого магазина. */
  store: string;
}

const KEYS: readonly MarketReportKey[] = ['real', 'turn', 'comp', 'shows', 'key', 'geo'];

const EMPTY_FORM: MarketReportForm = {
  period: null,
  month: null,
  categoryId: null,
  grouping: null,
  detalization: null,
};

/**
 * Форма и шесть фоновых задач — по одной на отчёт: переключение вкладки не
 * бросает заказанный отчёт (у двух из них квота 10 в час). Сверка эха
 * параметров и один перезапуск — в useReportJob.
 */
export function useMarketReportJobs() {
  const [form, setForm, , resetForm] = useBaseState<MarketReportForm>({ ...EMPTY_FORM });
  const [touched, setTouched, , resetTouched] = useBaseState<boolean>(false);

  const jobs = Object.fromEntries(
    KEYS.map((key) => [
      key,
      useReportJob<MarketReportResponse, Request>({
        launch: (current) => ({
          kind: marketReportJobKind(current.key),
          params: current.params,
          store: current.store,
        }),
        isOwn: (data, current) =>
          data.key === current.key && sameParams(data.params, current.params),
        // Результат — файл по кнопке; ссылка на задачу после суток не откроется.
        persist: false,
      }),
    ]),
  ) as Record<MarketReportKey, ReturnType<typeof useReportJob<MarketReportResponse, Request>>>;

  /** Значения по умолчанию — один раз, пока продавец ничего не выбирал. */
  function initForm(defaults: MarketReportForm): void {
    if (!touched.value) setForm({ ...defaults });
  }

  function setField<K extends keyof MarketReportForm>(field: K, value: MarketReportForm[K]): void {
    setTouched(true);
    setForm({ ...form.value, [field]: value });
  }

  function paramsOf(key: MarketReportKey): MarketReportParams | null {
    return marketParams(key, form.value);
  }

  /** Заказать отчёт у Маркета с параметрами формы. */
  function generate(key: MarketReportKey, store: string): Promise<void> {
    const params = paramsOf(key);
    if (params === null) return Promise.resolve();
    return jobs[key].run({ key, params, store });
  }

  function reportOf(key: MarketReportKey): MarketReport | null {
    const data = jobs[key].data.value;
    return data === null ? null : mapMarketReport(data);
  }

  /** Параметры, с которыми отчёт заказан (для подписи «что собрано»). */
  function requestedParams(key: MarketReportKey): MarketReportParams | null {
    return jobs[key].request.value?.params ?? null;
  }

  function isLoadingOf(key: MarketReportKey): boolean {
    return jobs[key].isLoading.value;
  }

  function errorOf(key: MarketReportKey): string | null {
    return jobs[key].error.value;
  }

  function retry(key: MarketReportKey): Promise<void> {
    return jobs[key].retry();
  }

  function download(key: MarketReportKey): Promise<void> {
    return jobs[key].download(reportOf(key)?.filename ?? undefined);
  }

  function reset(): void {
    for (const key of KEYS) jobs[key].reset();
    resetForm();
    resetTouched();
  }

  return {
    form,
    initForm,
    setField,
    paramsOf,
    generate,
    reportOf,
    requestedParams,
    isLoadingOf,
    errorOf,
    retry,
    download,
    reset,
  };
}
