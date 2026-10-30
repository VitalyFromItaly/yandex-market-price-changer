import type {
  PlanErrors,
  PlanRequest,
  PriceSetMarketplace,
  PriceSetMarkups,
  PriceSetPlan,
} from '../../price-set.domain';

import { computed } from 'vue';

import { priceSetApi } from '../../api/priceSetApi.price-set';
import { localFileError, mapPlanError } from '../../mappers/mapPriceSet.price-set';
import { PRICE_SET_KIND } from '../../price-set.domain';

import { useBaseState, useJob } from '@/shared/composables';

const NO_ERRORS: PlanErrors = { file: null, form: null, runningJobId: null };

/**
 * План цен: наценка — задача `POST /jobs`, файл — свой POST с файлом; дальше
 * один опрос. `useReportJob` не подходит: записи нужен id задачи плана, а
 * сохранённый в браузере план был бы чужим отпечатком — запись его отвергнет.
 *
 * План уже считается (409 PLAN_RUNNING) — опрос подхватывает ТУ задачу: её
 * итог продавец всё равно ждёт.
 */
export function usePlan() {
  const [request, setRequest, isSubmitting, resetRequest] = useBaseState<PlanRequest | null>(null);
  const [errors, setErrors, , resetErrors] = useBaseState<PlanErrors>(NO_ERRORS);
  const job = useJob<PriceSetPlan>();

  async function byMarkup(markups: PriceSetMarkups): Promise<void> {
    resetErrors();
    setRequest({ source: 'markup', markups });
    await job.start(PRICE_SET_KIND, { markups }, '');
  }

  async function byFile(file: File, marketplaces: PriceSetMarketplace[]): Promise<void> {
    job.reset();
    resetErrors();
    const local = localFileError(file);
    if (local !== null) {
      setErrors({ ...NO_ERRORS, file: local });
      return;
    }
    setRequest({ source: 'file', file, marketplaces });
    isSubmitting.value = true;
    try {
      const { jobId } = await priceSetApi.upload(file, marketplaces);
      job.track(jobId);
    } catch (caught) {
      const mapped = mapPlanError(caught);
      setErrors(mapped);
      if (mapped.runningJobId !== null) job.track(mapped.runningJobId);
    } finally {
      isSubmitting.value = false;
    }
  }

  async function retry(): Promise<void> {
    const current = request.value;
    if (current?.source === 'markup') await byMarkup(current.markups);
    if (current?.source === 'file') await byFile(current.file, current.marketplaces);
  }

  /** Ошибку под полем файла снимаем при выборе другого файла. */
  function clearFileError(): void {
    setErrors({ ...errors.value, file: null });
  }

  const data = computed<PriceSetPlan | null>(() => {
    const view = job.job.value;
    return view?.status === 'done' ? view.data : null;
  });
  /** Id задачи плана — запись пересчитает план по её запросу. */
  const jobId = computed(() => (data.value ? (job.job.value?.jobId ?? null) : null));
  const isLoading = computed(() => isSubmitting.value || job.isRunning.value);

  function reset(): void {
    job.reset();
    resetRequest();
    resetErrors();
  }

  return {
    data,
    jobId,
    isLoading,
    hasRequest: computed(() => request.value !== null),
    errors,
    failure: job.error,
    byMarkup,
    byFile,
    retry,
    clearFileError,
    reset,
  };
}
