import type { FinanceUploadErrors, FinanceUploadSummary } from '@/modules/finance/finance.domain';

import { accountingApi } from '../../api/accountingApi.accounting';
import { toWbPromotionUploadSummary } from '../../mappers/mapWbPromotionUpload.accounting';

import {
  localFinanceFileError,
  mapFinanceUploadError,
} from '@/modules/finance/mappers/mapUpload.finance';
import { useBaseState } from '@/shared/composables';

const NO_ERRORS: FinanceUploadErrors = { file: null, form: null, missing: [] };

/**
 * Отчёт WB «Продвижение» файлом (TASK-209): реклама по кампаниям справочной строкой
 * за выбранный месяц. Разбор и запись — в самом запросе (секунды), без фоновой задачи.
 * Отказы — те же коды файла, что у отчёта по платежам ЯМ, и тот же маппер.
 */
export function useWbPromotionUpload() {
  const [summary, setSummary, isUploading, resetSummary] =
    useBaseState<FinanceUploadSummary | null>(null);
  const [errors, setErrors, , resetErrors] = useBaseState<FinanceUploadErrors>(NO_ERRORS);

  async function uploadWbPromotion(file: File, month: string): Promise<void> {
    resetSummary();
    resetErrors();
    const local = localFinanceFileError(file);
    if (local !== null) {
      setErrors({ ...NO_ERRORS, file: local });
      return;
    }
    isUploading.value = true;
    try {
      setSummary(toWbPromotionUploadSummary(await accountingApi.uploadWbPromotion(file, month)));
    } catch (caught) {
      setErrors(mapFinanceUploadError(caught));
    } finally {
      isUploading.value = false;
    }
  }

  /** Ошибку под полем снимаем при выборе другого файла. */
  function clearWbPromotionFileError(): void {
    setErrors({ ...errors.value, file: null, missing: [] });
  }

  function reset(): void {
    resetSummary();
    resetErrors();
  }

  return {
    wbPromotionSummary: summary,
    wbPromotionErrors: errors,
    wbPromotionUploading: isUploading,
    uploadWbPromotion,
    clearWbPromotionFileError,
    reset,
  };
}
