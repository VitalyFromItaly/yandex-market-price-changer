import type { DayRange } from '@/shared/utils';

/**
 * «Топ товаров» (под `report_profit`): все проданные товары магазина за любой период и
 * разрезы по регионам покупателей и кластерам отгрузки. Числа —
 * задача `top-skus:summary` поверх того же ProfitService, что «Прибыль» и бот.
 */

export const TOP_SKUS_KIND = 'top-skus:summary';
export const TOP_SKUS_ROUTE_NAME = 'ym-top-skus';
export const DEEP_HISTORY_FEATURE = 'deep_history';

/** Строка разреза по месту (ответ API). */
export interface TopPlaceRow {
  name: string;
  count: number;
  revenue: number;
  net: number;
}

/** Товар (ответ API). */
export interface TopSkuRow {
  sku: string;
  name: string;
  count: number;
  revenue: number;
  net: number;
  margin: number | null;
  returns: number;
  byRegion?: TopPlaceRow[];
  byCluster?: TopPlaceRow[];
}

/** Ответ `top-skus:summary`. Даты эха — ДД-ММ-ГГГГ. */
export interface TopSkusResponse {
  period: { key: string; day: string | null; from?: string | null; to?: string | null };
  periodTitle: string;
  scope: 'placed' | 'redeemed';
  scopeLabel: string;
  orders: number;
  revenue: number;
  net: number;
  skus: TopSkuRow[];
  byRegion: TopPlaceRow[] | null;
  byCluster: TopPlaceRow[] | null;
  unconfirmedOrders: number;
  emptyText: string;
}

/** Запрос задачи: магазин и диапазон дней (ГГГГ-ММ-ДД). */
export interface TopSkusRequest {
  store: string;
  range: DayRange;
}

/** Вкладки экрана; «Регионы»/«Кластеры» открыты всегда. */
export type TopSkusTab = 'skus' | 'regions' | 'clusters';

export interface TopSkusTabMeta {
  key: TopSkusTab;
  label: string;
}

export const TOP_SKUS_TABS: readonly TopSkusTabMeta[] = [
  { key: 'skus', label: 'Товары' },
  { key: 'regions', label: 'Регионы' },
  { key: 'clusters', label: 'Кластеры' },
];

export type TopSkusSort = 'revenue' | 'count' | 'net' | 'margin';

export const TOP_SKUS_SORT_OPTIONS: readonly { value: TopSkusSort; label: string }[] = [
  { value: 'revenue', label: 'По продажам' },
  { value: 'count', label: 'По штукам' },
  { value: 'net', label: 'По чистой' },
  { value: 'margin', label: 'По марже' },
];

/** Строка таблицы места с долей от итога продаж. */
export interface TopPlaceView extends TopPlaceRow {
  /** Доля продаж, 0..1; итог ноль — `null`. */
  share: number | null;
}
