import type {
  OrderRow,
  OrderRowResponse,
  OrdersReport,
  OrdersReportResponse,
} from '../orders.domain';

import { ROW_TYPE_LABEL, statusLabel } from '../constants/orderStatus.orders';
import { ORDER_REPORT } from '../orders.domain';

import { formatCount } from '@/shared/utils';

const MOSCOW_DAY = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Дата строки в ДД-ММ-ГГГГ и ключ сортировки ГГГГММДД. У заказов Маркет отдаёт
 * ДД-ММ-ГГГГ, у возвратов — ISO со временем: его приводим к московскому дню,
 * как это делает withinPeriod на бэкенде.
 */
export function rowDate(raw: string): { date: string; dateSort: number } {
  const text = raw.trim();
  const plain = /^(\d{2})-(\d{2})-(\d{4})/.exec(text);
  if (plain) {
    const [, d, m, y] = plain;
    return { date: `${d}-${m}-${y}`, dateSort: Number(`${y}${m}${d}`) };
  }
  const parsed = new Date(text);
  if (text === '' || Number.isNaN(parsed.getTime())) return { date: '', dateSort: 0 };
  const [d, m, y] = MOSCOW_DAY.format(parsed).split('.');
  return { date: `${d}-${m}-${y}`, dateSort: Number(`${y}${m}${d}`) };
}

export function mapOrderRow(row: OrderRowResponse, index: number): OrderRow {
  return {
    id: `${row.type}:${row.orderId ?? 'none'}:${index}`,
    orderId: row.orderId,
    typeLabel: ROW_TYPE_LABEL[row.type],
    ...rowDate(row.date),
    statusLabel: statusLabel(row.status),
    items: row.items,
    sales: row.sales,
    subsidies: row.subsidies,
    withDelivery: row.withDelivery,
  };
}

/** Разбивка возвратов — те же слова, что formatReport бота. */
export function returnsLine(returns: OrdersReportResponse['returns']): string | null {
  if (returns === null || returns.count === 0) return null;
  if (returns.activeOnly) return `Активных возвратов: ${formatCount(returns.count)} — едут к вам`;
  return (
    `Возвраты: ${formatCount(returns.count)} — едет ${formatCount(returns.inFlight)}, ` +
    `выдано магазину ${formatCount(returns.settled)}`
  );
}

export function mapOrdersReport(response: OrdersReportResponse): OrdersReport {
  return {
    key: response.key,
    title: response.title,
    heading:
      response.takenAt === null ? (response.periodTitle ?? '') : `на ${response.takenAt} МСК`,
    count: response.count,
    totals: response.totals,
    period: response.period,
    assembling: response.assembling,
    returnsLine: returnsLine(response.returns),
    returnsSplit:
      response.returns === null || response.returns.activeOnly || response.returns.count === 0
        ? null
        : { inFlight: response.returns.inFlight, settled: response.returns.settled },
    notes: response.notes,
    emptyText: response.emptyText,
    hasTypes: response.key === ORDER_REPORT.RETURNING,
    rows: response.rows.map(mapOrderRow),
    file:
      response.file === null
        ? null
        : { filename: response.file.filename, truncated: response.file.truncated },
  };
}
