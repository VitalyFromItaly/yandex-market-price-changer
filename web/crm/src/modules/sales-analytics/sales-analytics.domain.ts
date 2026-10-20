import type { IUnconfirmedProfit } from '../../../../../src/shared/profit-confirmation';
/**
 * «Аналитика продаж» (TASK-140, ТЗ п.9) — выручка, заказы, штуки, средний чек и
 * скорость продаж за период: по дням, неделям и месяцам, по брендам, товарам и
 * площадкам. Раздел уровня аккаунта.
 *
 * Числа — разрезы того же P&L, что «Финансы» (`sales-analytics:summary` поверх
 * `FinanceService.build`): выручка любого разреза в сумме равна выручке
 * «Финансов» за тот же период. Площадка пока одна — Маркет; Ozon и Wildberries
 * подписаны «скоро», без нулей (решение `ozon_wb_skipped_for_now`).
 */
import type { DayRange } from '@/shared/utils';

export const SALES_ANALYTICS_ROUTE_NAME = 'ym-sales-analytics';
export const SALES_ANALYTICS_KIND = 'sales-analytics:summary';
/** Без «Финансов» продаж из журнала нет: задача получила бы 403 гейта. */
export const FINANCE_FEATURE = 'finance';

// --- ответ задачи ------------------------------------------------------------

export interface SalesFigures {
  revenueKopecks: number;
  units: number;
  orders: number;
  avgCheckKopecks: number | null;
  unitsPerDay: number | null;
}

export interface SalesPrevious {
  revenueKopecks: number;
  units: number;
}

export interface SalesDay {
  day: string;
  revenueKopecks: number;
  units: number;
  orders: number;
}

export interface SalesSku extends SalesFigures {
  sku: string;
  name: string | null;
  brand: string | null;
  previous: SalesPrevious | null;
}

export interface SalesBrand extends SalesFigures {
  key: string | null;
  title: string;
  skus: number;
  previous: SalesPrevious | null;
}

export interface SalesMarketplace extends SalesFigures {
  marketplace: string;
  label: string;
  previous: SalesPrevious | null;
}

export interface SalesAnalyticsResponse {
  period: DayRange;
  previousPeriod: DayRange;
  status: 'preliminary' | 'final' | 'verified' | 'discrepancy';
  statusLabel: string;
  periodDays: number;
  totals: SalesFigures;
  previousTotals: SalesFigures;
  days: SalesDay[];
  skus: SalesSku[];
  brands: SalesBrand[];
  rest: { revenueKopecks: number; units: number };
  marketplaces: SalesMarketplace[];
  unconfirmed: IUnconfirmedProfit;
}

export interface SalesRequest {
  range: DayRange;
  previous: DayRange;
}

// --- вид -----------------------------------------------------------------------

/** Разрез экрана. */
export type SalesSlice = 'time' | 'brand' | 'sku' | 'marketplace';

export const SALES_SLICE_OPTIONS: { value: SalesSlice; label: string }[] = [
  { value: 'time', label: 'По времени' },
  { value: 'brand', label: 'По брендам' },
  { value: 'sku', label: 'По товарам' },
  { value: 'marketplace', label: 'По площадкам' },
];

/** Шаг ряда: дни, недели (с понедельника), календарные месяцы. */
export type TimeGrain = 'day' | 'week' | 'month';

export const TIME_GRAIN_OPTIONS: { value: TimeGrain; label: string }[] = [
  { value: 'day', label: 'Дни' },
  { value: 'week', label: 'Недели' },
  { value: 'month', label: 'Месяцы' },
];

/** Что рисует график. Один ряд — одна ось (скил dataviz). */
export type SalesMetric = 'revenue' | 'units' | 'orders';

export const SALES_METRIC_OPTIONS: { value: SalesMetric; label: string }[] = [
  { value: 'revenue', label: 'Выручка' },
  { value: 'orders', label: 'Заказы' },
  { value: 'units', label: 'Штуки' },
];

export type SkuSort = 'revenue' | 'units' | 'velocity';

export const SKU_SORT_OPTIONS: { value: SkuSort; label: string }[] = [
  { value: 'revenue', label: 'По выручке' },
  { value: 'units', label: 'По штукам' },
  { value: 'velocity', label: 'По скорости' },
];

export type Tone = 'ok' | 'danger' | 'muted';

/** Корзина ряда: день, неделя или месяц. */
export interface SalesBucket {
  key: string;
  /** Подпись под столбцом и в таблице. */
  label: string;
  revenueKopecks: number;
  units: number;
  orders: number;
}

export interface SalesKpi {
  key: 'revenue' | 'orders' | 'units' | 'avgCheck' | 'velocity';
  label: string;
  value: string;
  caption: string | null;
}

/** Строка таблицы разреза (бренд, товар, площадка). */
export interface SalesRow {
  key: string;
  title: string;
  /** Артикул или число товаров под названием; null — нечего. */
  subtitle: string | null;
  revenue: string;
  revenueKopecks: number;
  units: string;
  orders: string;
  avgCheck: string;
  velocity: string;
  /** «+12 % к прошлому»; null — прошлого нет. */
  delta: string | null;
  deltaTone: Tone;
}

export const REST_TITLE = 'Не относится к товару';

export const REST_NOTE =
  'Продажи без артикула и без заказа с артикулами — их Маркет не относит к товару. ' +
  'С этой строкой сумма по брендам и товарам равна итогу.';

export const ORDERS_NOTE =
  'Заказ из нескольких товаров считается у каждого из них, поэтому заказы по брендам и ' +
  'товарам в сумме больше итога. Выручка и штуки складываются точно.';

export const VELOCITY_HINT = 'Скорость — штук в день за весь период, включая дни без продаж.';
