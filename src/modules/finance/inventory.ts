/**
 * Единый склад (TASK-142, ТЗ п.10) — чистая сборка строк раздела CRM «Склад».
 * Ввода-вывода нет: остатки, заказы в пути, возвраты и продажи собирает kind
 * `inventory:summary`, здесь только правила.
 *
 * Три правила, ради которых лист и существует:
 *  - **Итога «на всех складах» нет.** FBS площадок — это СВОЙ склад, показанный
 *    каждой площадкой (решение `inventory_own_stock_from_price_list`), а FBY/FBO/FBW —
 *    чужой склад (правило «FBY только для чтения»). Сумма удвоила бы свой склад.
 *  - **Стоимость остатков — свой склад плюс склады площадок, без FBS.** FBS —
 *    та же штука, что на своём складе; в стоимости она посчиталась бы дважды.
 *    Товар без себестоимости — отдельным счётчиком, не нулём рублей.
 *  - **«Нет данных» — `null`, не 0.** Ноль читался бы как «пусто» там, где
 *    площадка просто не сказала (возвраты Ozon, упавший магазин).
 */

import type { TMarketplace } from '../../shared/marketplace';

import { MARKETPLACES } from '../../shared/marketplace';

/** «Заканчивается» — меньше двух недель: столько обычно идёт поставка. */
export const INVENTORY_LOW_DAYS = 14;

/** На сколько дней хватит остатка; без продаж — `null`, а не бесконечность. */
export function daysLeftOf(stock: number, unitsPerDay: number): number | null {
  if (!(unitsPerDay > 0)) return null;
  return Math.floor(Math.max(0, stock) / unitsPerDay);
}

/** Количество в одном месте: резерв — сверх доступного, `null` — площадка не сообщает. */
export interface IInventoryAmount {
  available: number;
  reserved: number | null;
}

/** Остатки площадки по местам и артикулам; место без данных — `undefined`. */
export interface IInventoryLevels {
  seller?: Record<string, IInventoryAmount>;
  marketplace?: Record<string, IInventoryAmount>;
}

/** Всё, что известно о площадке; `null` у поля — данных нет (не ноль). */
export interface IInventoryMarketplaceInput {
  marketplace: TMarketplace;
  levels: IInventoryLevels | null;
  inTransit: ReadonlyMap<string, number> | null;
  returning: ReadonlyMap<string, number> | null;
  /**
   * Штуки за окно скорости (продано минус вернулось) по ID ТОВАРА: журнал Ozon/WB
   * ключуется ключом закупа (артикул ЯМ товара), а не артикулом площадки, и
   * свести его к товару может только вызывающий.
   */
  sold: ReadonlyMap<string, number> | null;
}

export interface IInventoryProduct {
  id: string;
  internalSku: string;
  name: string | null;
  skus: Partial<Record<TMarketplace, string>>;
  /** Свой склад из последнего прайса; `null` — в прайсе товара не было. */
  ownStock: number | null;
  ownStockAt: Date | null;
  /** Себестоимость штуки в рублях на сегодня; `null` — закупа нет. */
  costRub: number | null;
}

export interface IInventoryCell {
  seller: IInventoryAmount | null;
  marketplace: IInventoryAmount | null;
  inTransit: number | null;
  returning: number | null;
  sold: number | null;
}

export interface IInventoryRow {
  productId: string;
  internalSku: string;
  name: string | null;
  ownStock: number | null;
  ownStockAt: Date | null;
  costKopecks: number | null;
  byMarketplace: Partial<Record<TMarketplace, IInventoryCell>>;
  /** На складах площадок (FBY/FBO/FBW) — сумма по площадкам: разные штуки. */
  atMarketplaces: number;
  inTransit: number | null;
  returning: number | null;
  unitsPerDay: number | null;
  daysLeft: number | null;
  /** (свой склад + склады площадок) × себестоимость; `null` — себестоимости нет. */
  valueKopecks: number | null;
}

/** Карточка площадки, не привязанная к товару: числа есть, товара нет. */
export interface IInventoryUnmatched {
  marketplace: TMarketplace;
  sku: string;
  seller: number | null;
  marketplaceStock: number | null;
  inTransit: number | null;
  returning: number | null;
}

export interface IInventoryTotals {
  ownKopecks: number;
  marketplaceKopecks: number;
  /** Остаток есть, себестоимости нет — товаров и штук. */
  withoutCost: { products: number; units: number };
}

export interface IInventory {
  basisDays: number;
  lowDays: number;
  rows: IInventoryRow[];
  unmatched: IInventoryUnmatched[];
  totals: IInventoryTotals;
}

export function inventoryOf(
  products: readonly IInventoryProduct[],
  marketplaces: readonly IInventoryMarketplaceInput[],
  basisDays: number,
): IInventory {
  const bySku = new Map<TMarketplace, Map<string, IInventoryProduct>>();
  for (const product of products) {
    for (const marketplace of MARKETPLACES) {
      const sku = product.skus[marketplace];
      if (!sku) continue;
      let index = bySku.get(marketplace);
      if (!index) bySku.set(marketplace, (index = new Map()));
      index.set(sku, product);
    }
  }

  const totals: IInventoryTotals = {
    ownKopecks: 0,
    marketplaceKopecks: 0,
    withoutCost: { products: 0, units: 0 },
  };
  const rows: IInventoryRow[] = [];

  for (const product of products) {
    const row = rowOf(product, marketplaces, basisDays);
    if (!isWorthShowing(row)) continue;
    rows.push(row);

    const ownUnits = Math.max(0, product.ownStock ?? 0);
    const units = ownUnits + row.atMarketplaces;
    if (row.costKopecks === null) {
      if (units > 0) {
        totals.withoutCost.products += 1;
        totals.withoutCost.units += units;
      }
    } else {
      totals.ownKopecks += row.costKopecks * ownUnits;
      totals.marketplaceKopecks += row.costKopecks * row.atMarketplaces;
    }
  }

  rows.sort(
    (a, b) =>
      (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER) ||
      (b.unitsPerDay ?? 0) - (a.unitsPerDay ?? 0) ||
      a.internalSku.localeCompare(b.internalSku),
  );

  return {
    basisDays,
    lowDays: INVENTORY_LOW_DAYS,
    rows,
    unmatched: unmatchedOf(marketplaces, bySku),
    totals,
  };
}

function rowOf(
  product: IInventoryProduct,
  marketplaces: readonly IInventoryMarketplaceInput[],
  basisDays: number,
): IInventoryRow {
  const byMarketplace: Partial<Record<TMarketplace, IInventoryCell>> = {};
  let atMarketplaces = 0;
  let inTransit: number | null = null;
  let returning: number | null = null;
  let sold: number | null = null;

  for (const input of marketplaces) {
    const sku = product.skus[input.marketplace];
    const soldHere = input.sold?.get(product.id);
    if (!sku && soldHere === undefined) continue;
    const cell: IInventoryCell = {
      seller: sku && input.levels?.seller ? (input.levels.seller[sku] ?? ZERO) : null,
      marketplace:
        sku && input.levels?.marketplace ? (input.levels.marketplace[sku] ?? ZERO) : null,
      inTransit: sku && input.inTransit ? (input.inTransit.get(sku) ?? 0) : null,
      returning: sku && input.returning ? (input.returning.get(sku) ?? 0) : null,
      sold: input.sold ? (soldHere ?? 0) : null,
    };
    byMarketplace[input.marketplace] = cell;
    atMarketplaces += Math.max(0, cell.marketplace?.available ?? 0);
    inTransit = addKnown(inTransit, cell.inTransit);
    returning = addKnown(returning, cell.returning);
    sold = addKnown(sold, cell.sold);
  }

  const unitsPerDay = sold === null || !(basisDays > 0) ? null : Math.max(0, sold) / basisDays;
  const stock = Math.max(0, product.ownStock ?? 0) + atMarketplaces;
  const costKopecks =
    product.costRub === null || !Number.isFinite(product.costRub)
      ? null
      : Math.round(product.costRub * 100);

  return {
    productId: product.id,
    internalSku: product.internalSku,
    name: product.name,
    ownStock: product.ownStock,
    ownStockAt: product.ownStockAt,
    costKopecks,
    byMarketplace,
    atMarketplaces,
    inTransit,
    returning,
    unitsPerDay: unitsPerDay === null ? null : Math.round(unitsPerDay * 100) / 100,
    daysLeft: unitsPerDay === null ? null : daysLeftOf(stock, unitsPerDay),
    valueKopecks: costKopecks === null ? null : costKopecks * stock,
  };
}

const ZERO: IInventoryAmount = { available: 0, reserved: null };

function addKnown(sum: number | null, value: number | null): number | null {
  if (value === null) return sum;
  return (sum ?? 0) + value;
}

/** Товар без единого ненулевого числа — каталог, а не склад: строку не печатаем. */
function isWorthShowing(row: IInventoryRow): boolean {
  if ((row.ownStock ?? 0) > 0 || row.atMarketplaces > 0) return true;
  if ((row.inTransit ?? 0) > 0 || (row.returning ?? 0) > 0) return true;
  if ((row.unitsPerDay ?? 0) > 0) return true;
  return Object.values(row.byMarketplace).some(
    (cell) => (cell?.seller?.available ?? 0) > 0 || (cell?.seller?.reserved ?? 0) > 0,
  );
}

function unmatchedOf(
  marketplaces: readonly IInventoryMarketplaceInput[],
  bySku: ReadonlyMap<TMarketplace, ReadonlyMap<string, IInventoryProduct>>,
): IInventoryUnmatched[] {
  const result: IInventoryUnmatched[] = [];
  for (const input of marketplaces) {
    const known = bySku.get(input.marketplace);
    const skus = new Set<string>([
      ...Object.keys(input.levels?.seller ?? {}),
      ...Object.keys(input.levels?.marketplace ?? {}),
      ...(input.inTransit?.keys() ?? []),
      ...(input.returning?.keys() ?? []),
    ]);
    for (const sku of skus) {
      if (known?.has(sku)) continue;
      const entry: IInventoryUnmatched = {
        marketplace: input.marketplace,
        sku,
        seller: input.levels?.seller ? (input.levels.seller[sku]?.available ?? 0) : null,
        marketplaceStock: input.levels?.marketplace
          ? (input.levels.marketplace[sku]?.available ?? 0)
          : null,
        inTransit: input.inTransit ? (input.inTransit.get(sku) ?? 0) : null,
        returning: input.returning ? (input.returning.get(sku) ?? 0) : null,
      };
      const any =
        (entry.seller ?? 0) +
        (entry.marketplaceStock ?? 0) +
        (entry.inTransit ?? 0) +
        (entry.returning ?? 0);
      if (any > 0) result.push(entry);
    }
  }
  return result.sort(
    (a, b) => a.marketplace.localeCompare(b.marketplace) || a.sku.localeCompare(b.sku),
  );
}
