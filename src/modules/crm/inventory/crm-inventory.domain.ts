import type { TMarketplace } from '../../../shared/marketplace';
import type { IInventory, IInventoryAmount, IInventoryCell } from '../../finance/inventory';
import type { IInventoryColumn, IInventoryProblem } from '../../inventory/inventory.domain';

/**
 * «Склад» CRM (TASK-142) — доставка. Строки и суммы считает лист
 * `finance/inventory.ts`, площадки собирает `InventoryService`; здесь
 * перечисление полей ответа.
 */

export const INVENTORY_KIND = 'inventory:summary';

export {
  INVENTORY_BASIS_DAYS,
  INVENTORY_PLACE_LABEL,
  MARKETPLACE_ORDERS_WINDOW_NOTE,
  NOT_CONNECTED_TEXT,
  NO_JOURNAL_TEXT,
  OZON_RETURNS_UNAVAILABLE_TEXT,
  WB_TRANSIT_NOTE,
  YM_REPORT_CLOSED_TEXT,
} from '../../inventory/inventory.domain';
export type { TInventoryColumnState } from '../../inventory/inventory.domain';

export type ICrmInventoryProblem = IInventoryProblem;
export type ICrmInventoryColumn = IInventoryColumn;

export interface ICrmInventoryCell {
  seller: IInventoryAmount | null;
  marketplace: IInventoryAmount | null;
  inTransit: number | null;
  returning: number | null;
}

export interface ICrmInventoryRow {
  productId: string;
  internalSku: string;
  name: string | null;
  ownStock: number | null;
  ownStockAt: string | null;
  costKopecks: number | null;
  byMarketplace: Partial<Record<TMarketplace, ICrmInventoryCell>>;
  atMarketplaces: number;
  inTransit: number | null;
  returning: number | null;
  unitsPerDay: number | null;
  daysLeft: number | null;
  valueKopecks: number | null;
}

export interface ICrmInventoryView {
  takenAt: string;
  basisDays: number;
  lowDays: number;
  columns: ICrmInventoryColumn[];
  rows: ICrmInventoryRow[];
  unmatched: IInventory['unmatched'];
  totals: IInventory['totals'];
  /** Последняя загрузка прайса среди товаров — дата «своего склада». */
  ownStockAt: string | null;
  problems: ICrmInventoryProblem[];
  notes: string[];
}

function cellView(cell: IInventoryCell): ICrmInventoryCell {
  return {
    seller: cell.seller ? { ...cell.seller } : null,
    marketplace: cell.marketplace ? { ...cell.marketplace } : null,
    inTransit: cell.inTransit,
    returning: cell.returning,
  };
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function toCrmInventory(
  inventory: IInventory,
  extra: {
    now: Date;
    columns: ICrmInventoryColumn[];
    problems: ICrmInventoryProblem[];
    notes: string[];
  },
): ICrmInventoryView {
  let ownStockAt: Date | null = null;
  const rows = inventory.rows.map((row) => {
    if (row.ownStockAt && (!ownStockAt || row.ownStockAt > ownStockAt)) {
      ownStockAt = row.ownStockAt;
    }
    const byMarketplace: Partial<Record<TMarketplace, ICrmInventoryCell>> = {};
    for (const [marketplace, cell] of Object.entries(row.byMarketplace)) {
      if (cell) byMarketplace[marketplace as TMarketplace] = cellView(cell);
    }
    return {
      productId: row.productId,
      internalSku: row.internalSku,
      name: row.name,
      ownStock: row.ownStock,
      ownStockAt: iso(row.ownStockAt),
      costKopecks: row.costKopecks,
      byMarketplace,
      atMarketplaces: row.atMarketplaces,
      inTransit: row.inTransit,
      returning: row.returning,
      unitsPerDay: row.unitsPerDay,
      daysLeft: row.daysLeft,
      valueKopecks: row.valueKopecks,
    };
  });

  return {
    takenAt: extra.now.toISOString(),
    basisDays: inventory.basisDays,
    lowDays: inventory.lowDays,
    columns: extra.columns,
    rows,
    unmatched: inventory.unmatched.map((entry) => ({ ...entry })),
    totals: {
      ownKopecks: inventory.totals.ownKopecks,
      marketplaceKopecks: inventory.totals.marketplaceKopecks,
      withoutCost: { ...inventory.totals.withoutCost },
    },
    ownStockAt: iso(ownStockAt),
    problems: extra.problems,
    notes: extra.notes,
  };
}
