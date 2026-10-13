import type { LowStockRow, ProductTone, StocksResponse, TopSkuRow } from '../dashboard.domain';
import type { ProfitSku } from '@/modules/profit/profit.domain';

import { LOW_STOCK_LIMIT, STOCK_WARN_LIMIT, TOP_SKU_LIMIT } from '../dashboard.domain';

import { formatPercent } from '@/modules/profit/mappers/mapProfitReport.profit';
import { formatCount, formatRub } from '@/shared/utils';

/** Остаток артикула или null, когда остатков нет вовсе. Нет записи — ноль. */
function stockOf(levels: StocksResponse | null, sku: string): number | null {
  if (!levels?.stocks) return null;
  return levels.stocks[sku] ?? 0;
}

/** Тон маржи — тот же, что у карточки «Чистая»: убыток красным. */
function toneOf(row: ProfitSku): ProductTone {
  if (row.margin === null) return 'neutral';
  return row.net < 0 ? 'danger' : 'ok';
}

/** Цвет остатка: до порога «на исходе» — красный, до STOCK_WARN_LIMIT — жёлтый. */
function stockTone(stock: number | null, levels: StocksResponse | null): ProductTone {
  if (stock === null || !levels) return 'neutral';
  if (stock <= levels.threshold) return 'danger';
  return stock <= STOCK_WARN_LIMIT ? 'warn' : 'ok';
}

/** «2 (0,4%)» — доля возвратов от проданных штук; без возвратов — просто «0». */
function returnsLabel(row: ProfitSku): string {
  if (!row.returns || !row.count) return formatCount(row.returns);
  return `${formatCount(row.returns)} (${formatPercent(Math.round((row.returns / row.count) * 1000) / 10)}%)`;
}

/**
 * «Топ товаров»: первые десять по продажам — порядок задал бэкенд (`profitOf`),
 * здесь он не пересчитывается. Товар только с возвратами в топ не попадает:
 * продаж у него нет.
 */
export function mapTopSkus(
  bySku: readonly ProfitSku[],
  levels: StocksResponse | null,
): TopSkuRow[] {
  return bySku
    .filter((row) => row.count > 0)
    .slice(0, TOP_SKU_LIMIT)
    .map((row) => {
      const stock = stockOf(levels, row.sku);
      return {
        sku: row.sku,
        name: row.name,
        stock: stock === null ? null : formatCount(stock),
        stockTone: stockTone(stock, levels),
        sold: formatCount(row.count),
        revenue: formatRub(row.revenue),
        margin:
          row.margin === null ? null : `${formatPercent(Math.round(row.margin * 1000) / 10)}%`,
        tone: toneOf(row),
        returns: returnsLabel(row),
      };
    });
}

/**
 * «На исходе»: только проданные за период (решение crm_low_stock_threshold) с
 * остатком ≤ порога сервера. Сначала самые пустые, при равном остатке — что
 * продаётся лучше. Без остатков — пусто: блок сам говорит почему.
 */
export function mapLowStock(
  bySku: readonly ProfitSku[],
  levels: StocksResponse | null,
): LowStockRow[] {
  if (!levels?.stocks) return [];
  return bySku
    .filter((row) => row.count > 0)
    .map((row) => ({ row, stock: stockOf(levels, row.sku) ?? 0 }))
    .filter(({ stock }) => stock <= levels.threshold)
    .sort((a, b) => a.stock - b.stock || b.row.revenue - a.row.revenue)
    .slice(0, LOW_STOCK_LIMIT)
    .map(({ row, stock }) => ({
      sku: row.sku,
      name: row.name,
      stock: formatCount(stock),
      sold: formatCount(row.count),
      out: stock === 0,
    }));
}
