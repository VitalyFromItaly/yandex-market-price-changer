/**
 * «FBY» — зеркало ответа фоновой задачи `fby:overview`
 * (toCrmFbyView в src/modules/crm/fby/crm-fby.domain.ts).
 *
 * Подписи, порядок заявок и поставок, суммы кластеров приходят с сервера — из
 * тех же функций, что печатают экран бота. Каждый блок деградирует сам: `null`
 * — источник недоступен, это не «ноль».
 */

export const FBY_ROUTE_NAME = 'ym-fby';
export const FBY_JOB_KIND = 'fby:overview';

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

export interface FbyClusterResponse {
  title: string;
  totals: StockTotals;
  warehouses: { name: string; totals: StockTotals }[];
}

export interface FbyProblem {
  sku: string;
  name: string;
  defect: number;
  expired: number;
  utilization: number;
}

export interface FbyRequest {
  id: string;
  typeLabel: string;
  statusLabel: string;
  ready: boolean;
  defectCount: number;
  targetName: string | null;
}

export interface FbySupply {
  id: string;
  statusLabel: string;
  date: string | null;
  targetName: string | null;
  transitName: string | null;
  planCount: number;
  factCount: number;
}

export type FbySupplies =
  | { state: 'off' }
  | { state: 'error'; text: string }
  | { state: 'ok'; rows: FbySupply[]; terminal: number };

export interface FbyResponse {
  takenAt: string;
  stockTakenAt: string | null;
  stockTypes: StockTypeLabel[];
  stockHint: string;
  stockProblem: string | null;
  stock: {
    totals: StockTotals;
    clusters: FbyClusterResponse[];
    problems: FbyProblem[];
  } | null;
  requests: FbyRequest[] | null;
  requestsProblem: string | null;
  supplies: FbySupplies;
  inTransit: number | null;
  returning: number | null;
  file: { filename: string; rows: number; truncated: number } | null;
}

/** Строка таблицы кластеров: кластер или склад под ним. */
export interface FbyClusterRow {
  id: string;
  title: string;
  /** Склад внутри кластера — тише и с отступом. */
  nested: boolean;
  totals: StockTotals;
}

export interface FbyStock {
  totals: StockTotals;
  /** Колонки таблицы: «доступно» всегда, остальные — где есть хоть что-то. */
  columns: StockTypeLabel[];
  rows: FbyClusterRow[];
  problems: FbyProblem[];
}

export interface FbyReport {
  heading: string;
  stockHeading: string | null;
  stockHint: string;
  stockProblem: string | null;
  stockTypes: StockTypeLabel[];
  stock: FbyStock | null;
  requests: FbyRequest[] | null;
  requestsProblem: string | null;
  supplies: FbySupplies;
  inTransit: number | null;
  returning: number | null;
  file: { filename: string; rows: number; truncated: number } | null;
}
