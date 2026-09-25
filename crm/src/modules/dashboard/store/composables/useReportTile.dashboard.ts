import type { TileMeta, TileSummary } from '../../dashboard.domain';
import type { OrdersReportResponse } from '@/modules/orders/orders.domain';
import type { ProfitReportResponse } from '@/modules/profit/profit.domain';

import { computed } from 'vue';

import { mapOrdersTile, mapProfitTile } from '../../mappers/mapTiles.dashboard';

import { PROFIT_REPORT } from '@/modules/profit/profit.domain';
import { useReportJob } from '@/shared/composables';
import { periodParams, samePeriod } from '@/shared/period';

type TileResponse = OrdersReportResponse | ProfitReportResponse;

function summaryOf(data: TileResponse): TileSummary | null {
  if (data.key === PROFIT_REPORT.PROFIT) return mapProfitTile(data);
  if (data.key === PROFIT_REPORT.TARIFF) return null;
  return mapOrdersTile(data);
}

/**
 * Одна плитка главной: та же фоновая задача, что у страницы отчёта, и та же
 * сверка эха (useReportJob). Замок задачи общий со страницей — эхо и защищает
 * плитку от результата с периодом, выбранным там.
 */
export function useReportTile(meta: TileMeta) {
  const job = useReportJob<TileResponse, TileMeta & { store: string }>({
    launch: (current) => ({
      kind: current.kind,
      params: current.period === null ? {} : periodParams(current.period),
      store: current.store,
    }),
    isOwn: (data, current) =>
      data.key === current.report &&
      (current.period === null || samePeriod(data.period, current.period)),
  });

  const summary = computed(() => (job.data.value === null ? null : summaryOf(job.data.value)));

  /** Собрать плитку открытого магазина. */
  function load(store: string): Promise<void> {
    return job.run({ ...meta, store });
  }

  return {
    summary,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    isFresh: job.isFresh,
    savedAt: job.savedAt,
    error: job.error,
    load,
    retry: job.retry,
    reset: job.reset,
  };
}
