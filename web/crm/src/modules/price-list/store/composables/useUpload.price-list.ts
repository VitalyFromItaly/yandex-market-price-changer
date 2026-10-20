import type { StockSyncData, UploadAccepted, UploadErrors } from '../../price-list.domain';

import { computed } from 'vue';

import { priceListApi } from '../../api/priceListApi.price-list';
import {
  localFileError,
  mapStockSync,
  mapUploadError,
} from '../../mappers/mapPriceList.price-list';

import { useBaseState, useJob } from '@/shared/composables';

const NO_ERRORS: UploadErrors = { file: null, form: null, runningJobId: null };

/**
 * Загрузка прайса: отправка файла → предупреждение сервера → опрос задачи →
 * итог. Барьеры (фичи, модель, STOCK_WRITE_ENABLED) решает сервер тем же
 * сервисом, что у бота; здесь только показ.
 *
 * Прайс уже обрабатывается (409 UPLOAD_RUNNING) — опрос подхватывает ТУ
 * задачу: продавец видит, чем кончится предыдущий файл, и может загрузить
 * новый следом.
 */
export function useUpload() {
  const [accepted, setAccepted, isSubmitting, resetAccepted] = useBaseState<UploadAccepted | null>(
    null,
  );
  const [errors, setErrors, , resetErrors] = useBaseState<UploadErrors>(NO_ERRORS);
  const job = useJob<StockSyncData>();

  async function upload(file: File, dryRun: boolean, store: string): Promise<void> {
    job.reset();
    resetAccepted();
    resetErrors();

    const local = localFileError(file);
    if (local !== null) {
      setErrors({ ...NO_ERRORS, file: local });
      return;
    }

    isSubmitting.value = true;
    try {
      const response = await priceListApi.upload(file, dryRun, store);
      setAccepted(response);
      job.track(response.jobId);
    } catch (caught) {
      const mapped = mapUploadError(caught);
      setErrors(mapped);
      if (mapped.runningJobId !== null) job.track(mapped.runningJobId);
    } finally {
      isSubmitting.value = false;
    }
  }

  /** Ошибку под полем файла снимаем при выборе другого файла. */
  function clearFileError(): void {
    setErrors({ ...errors.value, file: null });
  }

  const result = computed(() => {
    const view = job.job.value;
    if (view?.status !== 'done' || view.data === null) return null;
    return mapStockSync(view.data);
  });

  function reset(): void {
    job.reset();
    resetAccepted();
    resetErrors();
  }

  return {
    accepted,
    errors,
    isSubmitting,
    isProcessing: job.isRunning,
    failure: job.error,
    result,
    upload,
    clearFileError,
    reset,
  };
}
