import { defineStore } from 'pinia';

import { useAnomalies } from './composables/useAnomalies.finance';
import { useAudit } from './composables/useAudit.finance';
import { useCashflow } from './composables/useCashflow.finance';
import { useMonths } from './composables/useMonths.finance';
import { usePnl } from './composables/usePnl.finance';
import { useUpload } from './composables/useUpload.finance';

import { useArticleOperations } from '@/shared/finance-operations';

/**
 * Стор раздела «Финансы» — фасад: месяц, P&L, раскрытие статьи, ДДС, сверка,
 * аномалии, ручная загрузка отчёта.
 * Что грузить при смене месяца, решает страница — она знает открытую вкладку.
 */
export const useFinanceStore = defineStore('finance', () => {
  const months = useMonths();
  const pnl = usePnl();
  const operations = useArticleOperations();
  const cashflow = useCashflow();
  const audit = useAudit();
  const anomalies = useAnomalies();
  const upload = useUpload();
  return {
    ...months,
    ...pnl,
    ...operations,
    ...cashflow,
    ...audit,
    ...anomalies,
    ...upload,
    /** Загрузка в выбранный месяц; после — свежие статусы месяцев. */
    async uploadToSelectedMonth(file: File): Promise<void> {
      const month = months.selectedMonth.value;
      if (month === null) return;
      await upload.uploadReport(file, month, () => months.loadMonths());
    },
    // Общий reset — последним, перекрывает reset слайсов.
    reset() {
      months.reset();
      pnl.reset();
      operations.reset();
      cashflow.reset();
      audit.reset();
      anomalies.reset();
      upload.reset();
    },
  };
});
