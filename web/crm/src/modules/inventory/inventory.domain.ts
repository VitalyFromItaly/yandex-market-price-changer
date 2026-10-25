/**
 * «Склад» (TASK-142): по товару — свой склад из прайса, склады площадок, в пути,
 * возвраты, стоимость остатков и дни запаса. Числа считает сервер; `null` —
 * «нет данных», не ноль.
 */

export const INVENTORY_KIND = 'inventory:summary';
export const FINANCE_FEATURE = 'finance';

export type InventoryMarketplace = 'ym' | 'ozon' | 'wb';

export interface InventoryAmount {
  available: number;
  /** Резерв сверх доступного; `null` — площадка его не сообщает. */
  reserved: number | null;
}

export interface InventoryColumn {
  marketplace: InventoryMarketplace;
  label: string;
  state: 'ok' | 'not-connected';
  /** Подписи мест: FBS и FBY / FBO / FBW. */
  places: { seller: string; marketplace: string };
  takenAt: string | null;
  hasReserve: boolean;
}

export interface InventoryCell {
  seller: InventoryAmount | null;
  marketplace: InventoryAmount | null;
  inTransit: number | null;
  returning: number | null;
}

export interface InventoryRow {
  productId: string;
  internalSku: string;
  name: string | null;
  ownStock: number | null;
  ownStockAt: string | null;
  costKopecks: number | null;
  byMarketplace: Partial<Record<InventoryMarketplace, InventoryCell>>;
  atMarketplaces: number;
  inTransit: number | null;
  returning: number | null;
  unitsPerDay: number | null;
  daysLeft: number | null;
  valueKopecks: number | null;
}

export interface InventoryUnmatched {
  marketplace: InventoryMarketplace;
  sku: string;
  seller: number | null;
  marketplaceStock: number | null;
  inTransit: number | null;
  returning: number | null;
}

export interface InventoryProblem {
  marketplace: InventoryMarketplace;
  storeName: string | null;
  problem: string;
}

/** Ответ `inventory:summary` — как отдал сервер. */
export interface InventoryResponse {
  /** Площадка экрана (эхо `params.marketplace`, TASK-182); старый ответ без неё — ЯМ. */
  marketplace?: InventoryMarketplace;
  takenAt: string;
  basisDays: number;
  lowDays: number;
  columns: InventoryColumn[];
  rows: InventoryRow[];
  unmatched: InventoryUnmatched[];
  totals: {
    ownKopecks: number;
    marketplaceKopecks: number;
    withoutCost: { products: number; units: number };
  };
  ownStockAt: string | null;
  problems: InventoryProblem[];
  notes: string[];
}

export type InventoryFilter = 'all' | 'low' | 'no-cost';
export type InventorySortKey =
  | 'name'
  | 'ownStock'
  | 'atMarketplaces'
  | 'inTransit'
  | 'unitsPerDay'
  | 'daysLeft'
  | 'valueKopecks';
export type SortDir = 'asc' | 'desc';

export const INVENTORY_FILTERS: ReadonlyArray<{ value: InventoryFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'low', label: 'Заканчиваются' },
  { value: 'no-cost', label: 'Без себестоимости' },
];
