import type { FinanceUploadErrors, FinanceUploadSummary } from '../../finance.domain';

import { financeApi } from '../../api/financeApi.finance';
import {
  localFinanceFileError,
  mapFinanceUploadError,
  toUploadSummary,
} from '../../mappers/mapUpload.finance';

import { useBaseState } from '@/shared/composables';

const NO_ERRORS: FinanceUploadErrors = { file: null, form: null, missing: [] };

/**
 * Ручная загрузка отчёта по платежам (TASK-114): файл → журнал месяца. Разбор и
 * запись — в самом запросе (секунды), поэтому без фоновой задачи; статус месяца
 * сервер обновляет следом, и `onDone` перечитывает список месяцев.
 */
export function useUpload() {
  const [summary, setSummary, isUploading, resetSummary] =
    useBaseState<FinanceUploadSummary | null>(null);
  const [errors, setErrors, , resetErrors] = useBaseState<FinanceUploadErrors>(NO_ERRORS);

  async function uploadReport(
    file: File,
    month: string,
    onDone?: () => Promise<void>,
  ): Promise<void> {
    resetSummary();
    resetErrors();
    const local = localFinanceFileError(file);
    if (local !== null) {
      setErrors({ ...NO_ERRORS, file: local });
      return;
    }
    isUploading.value = true;
    try {
      setSummary(toUploadSummary(await financeApi.upload(file, month)));
      if (onDone) await onDone();
    } catch (caught) {
      setErrors(mapFinanceUploadError(caught));
    } finally {
      isUploading.value = false;
    }
  }

  /** Ошибку под полем снимаем при выборе другого файла. */
  function clearUploadFileError(): void {
    setErrors({ ...errors.value, file: null, missing: [] });
  }

  function reset(): void {
    resetSummary();
    resetErrors();
  }

  return {
    uploadSummary: summary,
    uploadErrors: errors,
    uploading: isUploading,
    uploadReport,
    clearUploadFileError,
    reset,
  };
}
