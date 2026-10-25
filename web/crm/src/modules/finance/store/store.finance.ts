import type { FinanceMarketplace } from '../finance.domain';

import { defineStore } from 'pinia';

import { useAnomalies } from './composables/useAnomalies.finance';
import { useAudit } from './composables/useAudit.finance';
import { useCashflow } from './composables/useCashflow.finance';
import { useMonths } from './composables/useMonths.finance';
import { usePnl } from './composables/usePnl.finance';
import { useUpload } from './composables/useUpload.finance';

import { useBaseState } from '@/shared/composables';
import { useArticleOperations } from '@/shared/finance-operations';

/**
 * Стор раздела «Финансы» — фасад: месяц, P&L, раскрытие статьи, ДДС, сверка,
 * аномалии, ручная загрузка отчёта.
 * Что грузить при смене месяца, решает страница — она знает открытую вкладку.
 * Площадка экрана (TASK-180) — из адреса; её смена сбрасывает данные прежней.
 */
export const useFinanceStore = defineStore('finance', () => {
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<FinanceMarketplace>('ym');
  const months = useMonths(marketplace);
  const pnl = usePnl();
  const operations = useArticleOperations();
  const cashflow = useCashflow(marketplace);
  const audit = useAudit(marketplace);
  const anomalies = useAnomalies(marketplace);
  const upload = useUpload();

  function resetSlices(): void {
    months.reset();
    pnl.reset();
    operations.reset();
    cashflow.reset();
    audit.reset();
    anomalies.reset();
    upload.reset();
  }

  return {
    ...months,
    ...pnl,
    ...operations,
    ...cashflow,
    ...audit,
    ...anomalies,
    ...upload,
    marketplace,
    /** Площадка экрана; другая — данные прежней сброшены, месяцы грузятся заново. */
    selectMarketplace(next: FinanceMarketplace): void {
      if (next === marketplace.value) return;
      resetSlices();
      setMarketplace(next);
    },
    /** Загрузка в выбранный месяц; после — свежие статусы месяцев. */
    async uploadToSelectedMonth(file: File): Promise<void> {
      const month = months.selectedMonth.value;
      if (month === null) return;
      await upload.uploadReport(file, month, () => months.loadMonths());
    },
    // Общий reset — последним, перекрывает reset слайсов.
    reset() {
      resetSlices();
      resetMarketplace();
    },
  };
});
