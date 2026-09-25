import type { OrderReportKey, OrdersReport, OrdersReportResponse } from '../../orders.domain';
import type { ReportPeriod } from '@/shared/period';

import { computed } from 'vue';

import { mapOrdersReport } from '../../mappers/mapOrdersReport.orders';
import { ORDER_REPORT, ordersJobKind } from '../../orders.domain';

import { useBaseState, useReportJob } from '@/shared/composables';
import { DEFAULT_PERIOD, periodParams, samePeriod } from '@/shared/period';

interface Request {
  report: OrderReportKey;
  period: ReportPeriod;
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Отчёт о заказах: выбранный период, фоновая задача и её результат. Сверка
 * эха периода и один перезапуск — в useReportJob.
 */
export function useOrdersReport() {
  const [period, setPeriod, , resetPeriod] = useBaseState<ReportPeriod>(DEFAULT_PERIOD);
  const job = useReportJob<OrdersReportResponse, Request>({
    launch: (current) => ({
      kind: ordersJobKind(current.report),
      params: current.report === ORDER_REPORT.IN_TRANSIT ? {} : periodParams(current.period),
      store: current.store,
    }),
    isOwn: (data, current) =>
      data.key === current.report &&
      (current.report === ORDER_REPORT.IN_TRANSIT || samePeriod(data.period, current.period)),
  });

  /** Собрать отчёт открытого магазина за текущий период. */
  function load(report: OrderReportKey, store: string): Promise<void> {
    return job.run({ report, period: period.value, store });
  }

  const report = computed<OrdersReport | null>(() =>
    job.data.value === null ? null : mapOrdersReport(job.data.value),
  );

  /** Выбор периода; пересборку запускает страница — она знает активный отчёт. */
  function selectPeriod(next: ReportPeriod): void {
    setPeriod(next);
  }

  function download(): Promise<void> {
    return job.download(report.value?.file?.filename);
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
    download,
    reset,
  };
}
