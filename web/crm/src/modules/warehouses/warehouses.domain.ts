/**
 * «Склады» — зеркало ответа фоновой задачи `warehouses:overview`
 * (toCrmWarehousesView в src/modules/crm/warehouses/crm-warehouses.domain.ts).
 *
 * Соединение списка складов со стоком и «Итого» считает сервер теми же
 * функциями, что экран бота; фронт только показывает.
 */

/** Типы остатков FBY — ключи и подписи приходят с сервера (STOCK_SHORT_LABEL бота). */
export type StockType =
  | 'AVAILABLE'
  | 'FIT'
  | 'FREEZE'
  | 'QUARANTINE'
  | 'DEFECT'
  | 'EXPIRED'
  | 'UTILIZATION';

export type StockTotals = Record<StockType, number>;

export interface StockTypeLabel {
  type: StockType;
  label: string;
}

export const WAREHOUSES_ROUTE_NAME = 'ym-warehouses';
export const WAREHOUSES_JOB_KIND = 'warehouses:overview';

/** matched — в списке и в отчёте; list-only — только в списке; report-only — только в отчёте. */
export type WarehouseOrigin = 'matched' | 'list-only' | 'report-only';

export interface WarehouseRowResponse {
  key: string;
  name: string;
  address: string | null;
  ids: number[];
  origin: WarehouseOrigin;
  /** null — отчёта остатков нет вовсе, а не «пусто». */
  totals: StockTotals | null;
  count: number;
}

export interface StoreWarehouse {
  id: number;
  name: string;
  address: string | null;
  express: boolean;
  groupName: string | null;
}

export interface WarehousesResponse {
  takenAt: string;
  stockTakenAt: string | null;
  stockTypes: StockTypeLabel[];
  stockProblem: string | null;
  fbyHint: string;
  storeHint: string;
  notInListLabel: string;
  fby: WarehouseRowResponse[];
  sum: StockTotals | null;
  store: StoreWarehouse[];
  emptyText: string | null;
  /** xlsx остатков — та же книга, что в «FBY»; null — отчёта остатков нет. */
  file?: WarehousesFile | null;
}

export interface WarehousesFile {
  filename: string;
  rows: number;
  truncated: number;
}

export interface WarehousesReport {
  heading: string;
  stockHeading: string | null;
  stockProblem: string | null;
  fbyHint: string;
  storeHint: string;
  notInListLabel: string;
  /** Колонки остатков: «доступно» всегда, остальные — где в сумме что-то есть. */
  columns: StockTypeLabel[];
  rows: WarehouseRowResponse[];
  sum: StockTotals | null;
  store: StoreWarehouse[];
  emptyText: string | null;
  file: WarehousesFile | null;
}

export type WarehousesFilter = 'all' | 'stocked' | 'empty';
export const WAREHOUSES_FILTERS: readonly { value: WarehousesFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'stocked', label: 'С остатками' },
  { value: 'empty', label: 'Пустые' },
];
