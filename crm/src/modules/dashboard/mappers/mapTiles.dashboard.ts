import type { TileSummary } from '../dashboard.domain';
import type { OrdersReportResponse } from '@/modules/orders/orders.domain';
import type { ProfitResponse } from '@/modules/profit/profit.domain';

// Исключение из «не импортировать внутренности чужого модуля» (как форма пароля
// в ProfilePage): заголовок среза и подпись чистой берутся из мапперов страниц
// отчётов. Копия «на … МСК» / «Ожидается чистая» разошлась бы с экраном, в
// который ведёт плитка.
import { mapOrdersReport } from '@/modules/orders/mappers/mapOrdersReport.orders';
import { profitBreakdown } from '@/modules/profit/mappers/mapProfitReport.profit';
import { formatCount, formatRub } from '@/shared/utils';

export function mapOrdersTile(response: OrdersReportResponse): TileSummary {
  const report = mapOrdersReport(response);
  const empty = report.count === 0;
  return {
    value: formatCount(report.count),
    caption: empty ? null : `на ${formatRub(report.totals.sales)}`,
    heading: report.heading,
    empty,
    emptyText: report.emptyText,
    negative: false,
  };
}

export function mapProfitTile(response: ProfitResponse): TileSummary {
  const breakdown = profitBreakdown(response);
  const net = breakdown.rows.find((row) => row.kind === 'total');
  return {
    value: formatRub(net?.value ?? 0),
    caption:
      net === undefined
        ? null
        : `${net.label} · ${breakdown.countLabel.toLowerCase()} ${formatCount(breakdown.count)}`,
    heading: response.periodTitle,
    empty: response.empty,
    emptyText: response.emptyText,
    negative: net?.negative === true,
  };
}
