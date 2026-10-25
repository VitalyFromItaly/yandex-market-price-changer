import type {
  CompareColumn,
  CompareMarketplace,
  MarketplaceCompareResponse,
} from '@/modules/marketplace-compare/marketplace-compare.domain';
import type { RangeWithPrevious } from '@/shared/period';

/**
 * Дашборд «Площадки» (TASK-191): KPI и графики подключённых площадок за период.
 * Колонки — те же, что у «Сравнения площадок» (сервер собирает их тем же
 * `toCrmMarketplaceCompare`), плюс ряд по дням из журнала — тот же, что у
 * «Аналитики продаж» площадки. Прибыль по дням в журнале нет — она только за
 * период (решение marketplaces_dashboard_profit_by_period).
 */

export const MARKETPLACES_DASHBOARD_ROUTE_NAME = 'ym-marketplaces-dashboard';
export const MARKETPLACES_DASHBOARD_KIND = 'marketplaces-dashboard:summary';
export const MARKETPLACES_DASHBOARD_FEATURE = 'marketplaces_dashboard';

export type DashboardMarketplace = CompareMarketplace;

/** День ряда — как `SalesDay` «Аналитики продаж», деньги в копейках. */
export interface DashboardDay {
  day: string;
  revenueKopecks: number;
  units: number;
  orders: number;
}

export interface DashboardColumn extends CompareColumn {
  /** Пусто, если у колонки нет чисел (`state !== 'ok'`). */
  days: DashboardDay[];
}

export interface MarketplacesDashboardResponse extends Omit<MarketplaceCompareResponse, 'columns'> {
  columns: DashboardColumn[];
}

export type DashboardRequest = RangeWithPrevious;

/** Что рисует график во времени. Один ряд показателя — одна ось (скил dataviz). */
export type DashboardMetric = 'revenue' | 'orders';

export const DASHBOARD_METRIC_OPTIONS: { value: DashboardMetric; label: string }[] = [
  { value: 'revenue', label: 'Выручка' },
  { value: 'orders', label: 'Заказы' },
];
