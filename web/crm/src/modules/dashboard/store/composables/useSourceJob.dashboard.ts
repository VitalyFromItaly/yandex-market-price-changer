import type { KpiKey, KpiSummary, SourceMeta, StocksResponse } from '../../dashboard.domain';
import type { OrderRowSummaries } from '../../mappers/mapKpis.dashboard';
import type { FbyResponse } from '@/modules/fby/fby.domain';
import type { OrdersReportResponse } from '@/modules/orders/orders.domain';
import type { ProfitReportResponse } from '@/modules/profit/profit.domain';
import type { ReportPeriod } from '@/shared/period';

import { computed } from 'vue';

import { KPI, ORDER_ROW, SOURCE } from '../../dashboard.domain';
import {
  mapOrdersKpi,
  mapOrdersRow,
  mapProfitKpis,
  mapProfitRows,
  mapProfitSeries,
  mapStockKpi,
  mapUnitEconomics,
} from '../../mappers/mapKpis.dashboard';

import { mainBlock } from '@/modules/profit/mappers/mapProfitReport.profit';
import { PROFIT_REPORT } from '@/modules/profit/profit.domain';
import { useReportJob } from '@/shared/composables';
import { periodParams, samePeriod } from '@/shared/period';

type SourceResponse = OrdersReportResponse | ProfitReportResponse | FbyResponse | StocksResponse;

interface SourceRequest {
  store: string;
  period: ReportPeriod | null;
}

function summariesOf(meta: SourceMeta, data: SourceResponse): Partial<Record<KpiKey, KpiSummary>> {
  if (meta.key === SOURCE.FBY) return { [KPI.STOCK]: mapStockKpi(data as FbyResponse) };
  if (meta.key === SOURCE.PROFIT) {
    const profit = data as ProfitReportResponse;
    return profit.key === PROFIT_REPORT.PROFIT ? mapProfitKpis(profit) : {};
  }
  if (meta.key === SOURCE.IN_TRANSIT)
    return { [KPI.IN_TRANSIT]: mapOrdersKpi(data as OrdersReportResponse) };
  if (meta.key === SOURCE.RETURNING)
    return { [KPI.RETURNING]: mapOrdersKpi(data as OrdersReportResponse) };
  // «Выкуплено» карточки в ряду не имеет — только строку блока «Заказы».
  return {};
}

/** Строки блока «Заказы», которые даёт источник. */
function rowsOf(meta: SourceMeta, data: SourceResponse): OrderRowSummaries {
  if (meta.key === SOURCE.PROFIT) {
    const profit = data as ProfitReportResponse;
    return profit.key === PROFIT_REPORT.PROFIT ? mapProfitRows(profit) : {};
  }
  const row = {
    [SOURCE.IN_TRANSIT]: ORDER_ROW.IN_TRANSIT,
    [SOURCE.REDEEMED]: ORDER_ROW.REDEEMED,
    [SOURCE.RETURNING]: ORDER_ROW.RETURNING,
    [SOURCE.FBY]: null,
    [SOURCE.STOCKS]: null,
  }[meta.key];
  return row === null ? {} : { [row]: mapOrdersRow(data as OrdersReportResponse) };
}

/**
 * Один источник главной: та же фоновая задача, что у страницы отчёта, и та же
 * сверка эха (useReportJob). Замок задачи общий со страницей — эхо и защищает
 * карточки от результата с периодом, выбранным там. У FBY ключа и периода в
 * ответе нет — чужого результата не бывает (как в разделе «FBY»).
 */
export function useSourceJob(meta: SourceMeta) {
  const job = useReportJob<SourceResponse, SourceRequest>({
    launch: (current) => ({
      kind: meta.kind,
      params: current.period === null ? {} : periodParams(current.period),
      store: current.store,
    }),
    isOwn: (data, current) => {
      if (meta.report === null) return true;
      const report = data as OrdersReportResponse | ProfitReportResponse;
      return (
        report.key === meta.report &&
        (current.period === null || samePeriod(report.period, current.period))
      );
    },
  });

  const summaries = computed(() =>
    job.data.value === null ? null : summariesOf(meta, job.data.value),
  );
  const rows = computed(() => (job.data.value === null ? null : rowsOf(meta, job.data.value)));
  /** Ряд по дням — только у «Прибыли»: график читает тот же результат, что карточки. */
  const series = computed(() => {
    const data = job.data.value;
    if (meta.key !== SOURCE.PROFIT || data === null) return null;
    const profit = data as ProfitReportResponse;
    return profit.key === PROFIT_REPORT.PROFIT ? mapProfitSeries(profit) : null;
  });

  /** «Unit-экономика по площадкам» — тот же результат «Прибыли», что карточки. */
  const unitEconomics = computed(() => {
    const data = job.data.value;
    if (meta.key !== SOURCE.PROFIT || data === null) return null;
    const profit = data as ProfitReportResponse;
    return profit.key === PROFIT_REPORT.PROFIT ? mapUnitEconomics(profit) : null;
  });
  /** Товары основного блока «Прибыли» — «Топ» и «На исходе» читают тот же результат. */
  const skus = computed(() => {
    const data = job.data.value;
    if (meta.key !== SOURCE.PROFIT || data === null) return null;
    const profit = data as ProfitReportResponse;
    return profit.key === PROFIT_REPORT.PROFIT ? (mainBlock(profit).bySku ?? []) : null;
  });
  /** Остатки по артикулам — только у источника остатков. */
  const levels = computed(() =>
    meta.key === SOURCE.STOCKS ? (job.data.value as StocksResponse | null) : null,
  );

  /** Собрать источник открытого магазина с периодом, который ему положен. */
  function load(store: string, period: ReportPeriod | null): Promise<void> {
    return job.run({ store, period });
  }

  return {
    summaries,
    rows,
    series,
    skus,
    levels,
    unitEconomics,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    load,
    retry: job.retry,
    reset: job.reset,
  };
}
