import type { OrderReportKey, OrdersReport, OrdersReportResponse } from '../../orders.domain';
import type { ReportPeriod } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed } from 'vue';

import { mapOrdersReport } from '../../mappers/mapOrdersReport.orders';
import { ORDER_REPORT, ordersJobKind } from '../../orders.domain';

import { useReturnsRange } from './useReturnsRange.orders';

import { useBaseState, useReportJob } from '@/shared/composables';
import { DEFAULT_PERIOD, isoToDay, periodParams, samePeriod } from '@/shared/period';

interface Request {
  report: OrderReportKey;
  period: ReportPeriod;
  /** Окно дат «Едет обратно» (у остальных отчётов не читается). */
  range: DayRange | null;
  /** Ключ открытого магазина. */
  store: string;
}

/** Params задачи: «Едет обратно» — свой диапазон `range` (ДД-ММ-ГГГГ), остальные — пресет. */
export function ordersParams(request: Request): Record<string, unknown> {
  if (request.report === ORDER_REPORT.IN_TRANSIT) return {};
  if (request.report === ORDER_REPORT.RETURNING && request.range !== null) {
    return {
      period: { key: 'range', from: isoToDay(request.range.from), to: isoToDay(request.range.to) },
    };
  }
  return periodParams(request.period);
}

/** Ответ — того же отчёта и периода? Замок задачи на kind: быстрое переключение вернёт прежний. */
export function isOwnOrders(data: OrdersReportResponse, request: Request): boolean {
  if (data.key !== request.report) return false;
  if (request.report === ORDER_REPORT.IN_TRANSIT) return true;
  if (request.report === ORDER_REPORT.RETURNING && request.range !== null) {
    return (
      (data.period.key as string) === 'range' &&
      data.period.from === isoToDay(request.range.from) &&
      data.period.to === isoToDay(request.range.to)
    );
  }
  return samePeriod(data.period, request.period);
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
      params: ordersParams(current),
      store: current.store,
    }),
    isOwn: isOwnOrders,
  });
  const returnsRange = useReturnsRange();

  /** Собрать отчёт открытого магазина за текущий период. */
  function load(report: OrderReportKey, store: string): Promise<void> {
    return job.run({ report, period: period.value, range: returnsRange.range.value, store });
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
    returnsRange.reset();
  }

  return {
    period,
    selectPeriod,
    returnsPreset: returnsRange.preset,
    returnsCustom: returnsRange.custom,
    returnsRange: returnsRange.range,
    chooseReturnsPreset: returnsRange.choosePreset,
    chooseReturnsCustom: returnsRange.chooseCustom,
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
