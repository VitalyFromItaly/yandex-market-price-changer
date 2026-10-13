/**
 * Остатки по артикулам — только ЧТЕНИЕ, для главной CRM («Топ товаров» и
 * «Остатки на исходе»). Чистый модуль: суммы, выбор типа и отсев чужих складов,
 * без Nest и сети.
 *
 * Число — ДОСТУПНЫЙ остаток (`AVAILABLE`): то, что ещё можно продать. На FBY он
 * берётся из отчёта остатков (строки sku×склад), на FBS — из `offers/stocks`.
 */

import type { IFbyStockRow } from '../fby/fby-stock-report';
import type { IWarehouseOfferStock } from '../yandex-api.client';

/** Порог «на исходе», штук включительно — решение `crm_low_stock_threshold`. */
export const LOW_STOCK_THRESHOLD = 3;

/** FBY: доступный остаток по артикулу — сумма по всем складам Маркета. */
export function fbyStockLevels(rows: readonly IFbyStockRow[]): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const row of rows ?? []) {
    if (!row?.sku) continue;
    levels[row.sku] = (levels[row.sku] ?? 0) + (Number(row.totals?.AVAILABLE) || 0);
  }
  return levels;
}

/**
 * Число одного склада: `AVAILABLE`, а без него — `FIT` (годный, его и пишет
 * продавец). Ни того ни другого — 0: склад товар упомянул, а годного нет.
 */
function availableOf(stocks: IWarehouseOfferStock['stocks']): number {
  const byType = (type: string): number | undefined => {
    const entry = (stocks ?? []).find((stock) => stock?.type === type);
    return entry ? Number(entry.count) || 0 : undefined;
  };
  return byType('AVAILABLE') ?? byType('FIT') ?? 0;
}

/**
 * FBS/DBS: доступный остаток по артикулу — сумма по СОБСТВЕННЫМ складам
 * продавца. Чужие (склад возвратов Маркета, довод `getWarehouseId`) отсеиваются:
 * товар, ждущий там забора, продать нельзя. Список своих складов неизвестен
 * (пустой) — отсеивать не по чему, считаются все.
 */
export function storeStockLevels(
  offers: readonly IWarehouseOfferStock[],
  ownWarehouseIds: ReadonlySet<number>,
): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const offer of offers ?? []) {
    if (ownWarehouseIds.size && !ownWarehouseIds.has(offer.warehouseId)) continue;
    levels[offer.offerId] = (levels[offer.offerId] ?? 0) + availableOf(offer.stocks);
  }
  return levels;
}
