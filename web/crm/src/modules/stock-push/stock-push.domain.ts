/**
 * «Передача остатков» (TASK-143): сквозной остаток своего склада и план записи
 * по площадкам. Числа и решения — с сервера; здесь только типы и подписи.
 */

export const STOCK_PUSH_ROUTE_NAME = 'ym-stock-push';
export const STOCK_PUSH_KIND = 'stock-push:plan';

export type StockPushMarketplace = 'ym' | 'ozon' | 'wb';

export type StockPushBlock =
  | 'placement'
  | 'read-error'
  | 'orders-unknown'
  | 'zeroing'
  | 'no-warehouse'
  | 'several-warehouses'
  | 'no-write-method';

export interface StockPushRow {
  internalSku: string;
  name: string | null;
  sku: string;
  from: number;
  to: number;
  priceListStock: number;
  sold: number;
}

export interface StockPushTarget {
  marketplace: StockPushMarketplace;
  marketplaceLabel: string;
  key: string;
  name: string;
  placement: string | null;
  blockedBy: StockPushBlock | null;
  blockedText: string | null;
  error: string | null;
  updates: StockPushRow[];
  zeroed: number;
  unchanged: number;
  notListed: number;
  willWrite: boolean;
}

export interface StockPushPlan {
  takenAt: string;
  priceListDay: string | null;
  planHash: string;
  writeOpen: boolean;
  writeCount: number;
  ruleText: string;
  notes: string[];
  orderErrors: { marketplaceLabel: string; source: string; error: string }[];
  notConsidered: { marketplaceLabel: string; reason: string }[];
  targets: StockPushTarget[];
  skipped: { internalSku: string; name: string | null; reason: string; reasonText: string }[];
}

export interface StockPushWrite {
  marketplace: StockPushMarketplace;
  key: string;
  name: string;
  requested: number;
  written: number;
  errors: { batch: number; message: string }[];
  /** Позиции, которые площадке не отправлялись (WB — несколько размеров). */
  skipped: { sku: string; reason: string }[];
  skipReason?: 'placement' | 'write-disabled' | 'feature-disabled';
}

export interface StockPushApplyResult {
  writes: StockPushWrite[];
}

export const PUSH_RUNNING = 'PUSH_RUNNING';

/** Статус карточки площадки — одна подпись и один цвет на смысл. */
export interface TargetStatus {
  label: string;
  variant: 'ok' | 'warn' | 'danger' | 'default';
}
