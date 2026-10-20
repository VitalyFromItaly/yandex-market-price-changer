import type { ProfitReportKey, ProfitReportResponse, ProfitScreen } from '../../profit.domain';
import type { ReportPeriod } from '@/shared/period';

import { computed } from 'vue';

import { mapProfitScreen } from '../../mappers/mapProfitReport.profit';
import { profitJobKind } from '../../profit.domain';

import { useBaseState, useReportJob } from '@/shared/composables';
import { DEFAULT_PERIOD, periodParams, samePeriod } from '@/shared/period';

interface Request {
  report: ProfitReportKey;
  period: ReportPeriod;
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Вкладка раздела «Прибыль»: выбранный период, фоновая задача и её результат.
 * Сверка эха периода и один перезапуск — в useReportJob.
 */
export function useProfitReport() {
  const [period, setPeriod, , resetPeriod] = useBaseState<ReportPeriod>(DEFAULT_PERIOD);
  const job = useReportJob<ProfitReportResponse, Request>({
    launch: (current) => ({
      kind: profitJobKind(current.report),
      params: periodParams(current.period),
      store: current.store,
    }),
    isOwn: (data, current) =>
      data.key === current.report && samePeriod(data.period, current.period),
  });

  /** Собрать вкладку открытого магазина за текущий период. */
  function load(report: ProfitReportKey, store: string): Promise<void> {
    return job.run({ report, period: period.value, store });
  }

  const report = computed<ProfitScreen | null>(() =>
    job.data.value === null ? null : mapProfitScreen(job.data.value),
  );

  /** Выбор периода; пересборку запускает страница — она знает активную вкладку. */
  function selectPeriod(next: ReportPeriod): void {
    setPeriod(next);
  }

  function reset(): void {
    job.reset();
    resetPeriod();
  }

  return {
    period,
    selectPeriod,
    report,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    isFresh: job.isFresh,
    savedAt: job.savedAt,
    error: job.error,
    load,
    retry: job.retry,
    reset,
  };
}
