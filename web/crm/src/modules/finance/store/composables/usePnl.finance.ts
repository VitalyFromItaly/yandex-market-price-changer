import type { PnlModel, PnlRequest, PnlResponse } from '../../finance.domain';

import { computed } from 'vue';

import { FINANCE_PNL_KIND } from '../../finance.domain';
import { toPnlModel } from '../../mappers/mapPnl.finance';

import { useReportJob } from '@/shared/composables';

/**
 * P&L месяца — фоновая задача уровня аккаунта (`finance:pnl`, магазина нет):
 * текущий непроверенный месяц строит рядом плоскую оценку и ходит в Маркет.
 * Замок задачи — на продавца, поэтому ответ сверяется с эхом месяца или
 * периода: месяц и произвольный период — разные запросы, даже на тех же днях.
 * Площадка (TASK-137) — тоже часть эха: Ozon и ЯМ одного месяца — разные ответы.
 * Какую площадку просить, решает страница по адресу (TASK-180).
 */
export function usePnl() {
  const job = useReportJob<PnlResponse, PnlRequest>({
    launch: (current) => ({ kind: FINANCE_PNL_KIND, params: { ...current }, store: '' }),
    isOwn: (data, current) =>
      (data.marketplace ?? 'ym') === (current.marketplace ?? 'ym') &&
      ('month' in current
        ? data.month === current.month
        : data.month === null && data.from === current.from && data.to === current.to),
  });

  const pnl = computed<PnlModel | null>(() =>
    job.data.value === null ? null : toPnlModel(job.data.value),
  );

  function loadPnl(request: PnlRequest): Promise<void> {
    return job.run(request);
  }

  return {
    pnl,
    pnlLoading: job.isLoading,
    pnlRefreshing: job.isRefreshing,
    pnlSavedAt: job.savedAt,
    pnlError: job.error,
    loadPnl,
    retryPnl: job.retry,
    reset: job.reset,
  };
}
