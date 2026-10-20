import type { ReportPeriod } from '@/shared/period';

/**
 * Отчёты о заказах: «Уехало клиенту», «Выкуплено», «Едет обратно», «Едет до
 * клиента». Зеркало ответа фоновой задачи `orders:<report>`
 * (toCrmOrdersView в src/modules/crm/orders/crm-orders.domain.ts).
 *
 * Суммы и счётчики приходят готовыми — это тот же OrderReportsService, что у
 * бота. Фронт только показывает, сортирует и ищет.
 */

export const ORDER_REPORT = {
  SHIPPED: 'shipped_today',
  REDEEMED: 'redeemed',
  RETURNING: 'returning',
  IN_TRANSIT: 'in_transit',
} as const;

export type OrderReportKey = (typeof ORDER_REPORT)[keyof typeof ORDER_REPORT];

export interface OrderReportMeta {
  key: OrderReportKey;
  /** Подпись — как кнопка бота, без эмодзи. */
  label: string;
  /** Фича, закрывающая отчёт (FEATURE.REPORT_* на бэкенде). */
  feature: string;
  /** Есть ли у отчёта период. «Едет до клиента» — срез «сейчас», периода нет. */
  periodic: boolean;
  /**
   * Может ли «Другой день» уйти глубже 30 дней при открытой deep_history.
   * Из четырёх — только «Выкуплено» (довод askDay бота: у остальных архив
   * не умеет нужного фильтра даты или подстатусов).
   */
  deepCapable: boolean;
}

export const ORDER_REPORTS: readonly OrderReportMeta[] = [
  {
    key: ORDER_REPORT.SHIPPED,
    label: 'Уехало клиенту',
    feature: 'report_shipped_today',
    periodic: true,
    deepCapable: false,
  },
  {
    key: ORDER_REPORT.REDEEMED,
    label: 'Выкуплено',
    feature: 'report_redeemed',
    periodic: true,
    deepCapable: true,
  },
  {
    key: ORDER_REPORT.RETURNING,
    label: 'Едет обратно',
    feature: 'report_returning',
    periodic: true,
    deepCapable: false,
  },
  {
    key: ORDER_REPORT.IN_TRANSIT,
    label: 'Едет до клиента',
    feature: 'report_in_transit',
    periodic: false,
    deepCapable: false,
  },
];

export const DEEP_HISTORY_FEATURE = 'deep_history';

export function ordersJobKind(key: OrderReportKey): string {
  return `orders:${key}`;
}

export type OrderRowType = 'order' | 'nonRedemption' | 'return';

export interface OrderRowResponse {
  orderId: number | null;
  type: OrderRowType;
  /** DD-MM-YYYY у заказов, ISO у возвратов — как отдаёт Маркет. */
  date: string;
  status: string;
  items: string;
  sales: number;
  subsidies: number;
  withDelivery: number;
}

export interface MoneyTotals {
  sales: number;
  subsidies: number;
  withDelivery: number;
}

export interface OrdersReportResponse {
  key: OrderReportKey;
  title: string;
  count: number;
  totals: MoneyTotals;
  period: ReportPeriod;
  periodTitle: string | null;
  takenAt: string | null;
  assembling: number | null;
  returns: { count: number; inFlight: number; settled: number; activeOnly: boolean } | null;
  notes: string[];
  emptyText: string;
  rows: OrderRowResponse[];
  file: { filename: string; rows: number; truncated: number } | null;
}

export interface OrderRow {
  /** Ключ строки в таблице — номер заказа не уникален (невыкуп и возврат одного заказа). */
  id: string;
  orderId: number | null;
  typeLabel: string;
  /** ДД-ММ-ГГГГ по Москве; пусто — даты нет. */
  date: string;
  /** Для сортировки: ГГГГММДД, 0 — даты нет. */
  dateSort: number;
  statusLabel: string;
  items: string;
  sales: number;
  subsidies: number;
  withDelivery: number;
}

/** Модель экрана. */
export interface OrdersReport {
  key: OrderReportKey;
  title: string;
  /** «за сегодня, 03-08-2026» или «на 03-08-2026 10:00 МСК» у среза. */
  heading: string;
  count: number;
  totals: MoneyTotals;
  period: ReportPeriod;
  assembling: number | null;
  /** Строка разбивки возвратов — те же слова, что у бота; null — возвратов нет. */
  returnsLine: string | null;
  /** Та же разбивка числами — для полосы «едет / выдано»; null, когда разбивать нечего. */
  returnsSplit: { inFlight: number; settled: number } | null;
  notes: string[];
  emptyText: string;
  /** Колонка «Тип» нужна только «Едет обратно». */
  hasTypes: boolean;
  rows: OrderRow[];
  file: { filename: string; truncated: number } | null;
}

export type SortKey = 'orderId' | 'date' | 'status' | 'sales' | 'withDelivery';
export type SortDir = 'asc' | 'desc';
