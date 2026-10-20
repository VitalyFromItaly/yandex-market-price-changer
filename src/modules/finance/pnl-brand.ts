/**
 * Экономика по брендам — свёртка разреза P&L по товарам (`pnl.skus.skus`).
 *
 * Своей формулы нет: каждое число — сумма уже посчитанных строк товаров, поэтому
 * Σ брендов = Σ товаров по построению. «Не относится к товару» (`pnl.skus.rest`)
 * сюда не входит — вызывающий отдаёт его отдельной строкой. Бренд выводится из
 * названия и категории товара (`brandOf`), как в «Аналитике продаж»: товар,
 * которого нет в базе, — «Остальные».
 */

import type { IPnlSku, TSkuColumns } from './pnl-sku';
import type { IBrandSource, TBrandKey } from '../yandex/reports/brands';

import { BRAND_KEYS, brandOf, brandTitle } from '../yandex/reports/brands';

import { SKU_COLUMNS } from './pnl-sku';
import { OTHER_BRAND_TITLE } from './sales-analytics';

export interface IPnlBrandSku {
  sku: string;
  name: string | null;
  units: number;
  revenueKopecks: number;
  netKopecks: number;
  costKnown: boolean;
}

export interface IPnlBrand {
  /** null — «Остальные»: товар вне реестра брендов или не найден в базе. */
  key: TBrandKey | null;
  title: string;
  columns: TSkuColumns;
  cogsKopecks: number;
  taxKopecks: number;
  netKopecks: number;
  units: number;
  /** Σ заказов по товарам: заказ с двумя товарами бренда посчитан дважды. */
  orders: number;
  /** Товаров с движением в периоде. */
  skus: number;
  /** false — хоть у одного товара бренда нет закупа на дату: чистая завышена. */
  costKnown: boolean;
  /** Товары бренда по чистой, по убыванию. */
  items: IPnlBrandSku[];
}

const emptyColumns = (): TSkuColumns =>
  Object.fromEntries(SKU_COLUMNS.map((c) => [c, 0])) as TSkuColumns;

/** Бренды в порядке реестра, «Остальные» последними; бренды без товаров не попадают. */
export function brandEconomicsOf(
  skus: readonly IPnlSku[],
  products: ReadonlyMap<string, IBrandSource>,
): IPnlBrand[] {
  const byBrand = new Map<TBrandKey | null, IPnlBrand>();
  for (const row of skus) {
    const product = products.get(row.sku);
    const key = product ? brandOf(product) : null;
    const brand = byBrand.get(key) ?? {
      key,
      title: key ? brandTitle(key) : OTHER_BRAND_TITLE,
      columns: emptyColumns(),
      cogsKopecks: 0,
      taxKopecks: 0,
      netKopecks: 0,
      units: 0,
      orders: 0,
      skus: 0,
      costKnown: true,
      items: [],
    };
    for (const column of SKU_COLUMNS) brand.columns[column] += row.columns[column];
    brand.cogsKopecks += row.cogsKopecks;
    brand.taxKopecks += row.taxKopecks;
    brand.netKopecks += row.netKopecks;
    brand.units += row.units;
    brand.orders += row.orders;
    brand.skus += 1;
    brand.costKnown = brand.costKnown && row.costKnown;
    brand.items.push({
      sku: row.sku,
      name: product?.name || null,
      units: row.units,
      revenueKopecks: row.columns.revenue,
      netKopecks: row.netKopecks,
      costKnown: row.costKnown,
    });
    byBrand.set(key, brand);
  }
  for (const brand of byBrand.values()) {
    brand.items.sort((a, b) => b.netKopecks - a.netKopecks || a.sku.localeCompare(b.sku));
  }
  return [...BRAND_KEYS, null].filter((key) => byBrand.has(key)).map((key) => byBrand.get(key));
}
