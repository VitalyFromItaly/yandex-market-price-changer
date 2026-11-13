import type {
  AccountingDashboardDrillResponse,
  AccountingDashboardDrillView,
  AccountingMarketplace,
  DashboardDrillOrderResponse,
  DashboardDrillRecordResponse,
} from '../accounting.domain';

import { DASHBOARD_UNKNOWN_LABEL, dashboardReasonText } from './mapAccountingDashboard.accounting';

import { rangeLabel } from '@/shared/period';
import { formatCount, formatDay, formatKopecks } from '@/shared/utils';

const money = (kopecks: number | null) =>
  kopecks === null ? DASHBOARD_UNKNOWN_LABEL : formatKopecks(kopecks);

export const DRILL_SOURCE_LABEL: Record<DashboardDrillRecordResponse['source'], string> = {
  journal: 'Операция площадки',
  manual: 'Ручная операция',
  order: 'Заказ',
  expense: 'Расход',
  purchase: 'Оплата закупа',
  tax: 'Налог',
};

const MARKETPLACE_SHORT: Record<AccountingMarketplace, string> = {
  ym: 'Яндекс Маркет',
  ozon: 'Ozon',
  wb: 'Wildberries',
};

/** «Показано 500 из 1 230» — только когда сервер обрезал список. */
function shownNote(shown: number, total: number): string | null {
  return total > shown ? `Показано ${formatCount(shown)} из ${formatCount(total)}` : null;
}

function orderNote(order: DashboardDrillOrderResponse): string | null {
  if (order.kopecks === null) return dashboardReasonText(order.reason);
  return order.expected ? 'Ожидается' : null;
}

/** Раскрытие строки панели (TASK-231): операции, суммы заказов и записи продавца. */
export function mapAccountingDashboardDrill(
  data: AccountingDashboardDrillResponse,
): AccountingDashboardDrillView {
  return {
    title: data.title,
    subtitle: `${data.label} · ${data.basisTitle.toLowerCase()} · ${rangeLabel(data.period)}`,
    totalLabel: money(data.kopecks),
    operations: data.operations.map((o) => ({
      key: `${o.origin}|${o.id}`,
      title: o.title,
      dayLabel: formatDay(o.accruedOn),
      marketplaceLabel: MARKETPLACE_SHORT[o.marketplace] ?? o.marketplace,
      documentLabel: o.documentId,
      manual: o.origin === 'manual',
      amountLabel: formatKopecks(o.kopecks),
    })),
    operationsNote: shownNote(data.operations.length, data.operationsTotal),
    orders: data.orders.map((o) => ({
      key: `${o.marketplace}|${o.orderId}`,
      marketplace: o.marketplace,
      orderId: o.orderId,
      title: o.title || 'Без названия',
      amountLabel: money(o.kopecks),
      note: orderNote(o),
      expected: o.expected,
    })),
    ordersNote: shownNote(data.orders.length, data.ordersTotal),
    records: data.records.map((r) => ({
      key: `${r.source}|${r.id}`,
      title: r.title,
      sourceLabel: DRILL_SOURCE_LABEL[r.source] ?? r.source,
      amountLabel: money(r.kopecks),
    })),
    isEmpty: !data.operations.length && !data.orders.length && !data.records.length,
  };
}
