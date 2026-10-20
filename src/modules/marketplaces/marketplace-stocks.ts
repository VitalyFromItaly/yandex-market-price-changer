import type { IMarketplaceStockLevels, IStockAmount, TStockLocation } from './marketplace-adapter';
import type { IStockLevels } from '../yandex/stocks/stock-levels.service';

import { isFby } from '../yandex/stocks/placement';

/**
 * Остатки ЯМ → наша сущность (TASK-163). У кампании ЯМ одна модель, поэтому
 * непусто ровно одно место: FBY — склад Маркета, остальное — склад продавца.
 * Число то же, что отдал `StockLevelsService` (AVAILABLE, иначе FIT); резерв
 * ЯМ здесь не сообщает.
 */
export function ymStockLevels(levels: IStockLevels): IMarketplaceStockLevels {
  const placement = levels.placement ?? null;
  if (!levels.stocks) {
    return { takenAt: levels.takenAt, byLocation: {}, placement, error: levels.error ?? 'generic' };
  }
  const location: TStockLocation = isFby(placement) ? 'marketplace' : 'seller';
  const amounts: Record<string, IStockAmount> = {};
  for (const [sku, available] of Object.entries(levels.stocks)) {
    amounts[sku] = { available, reserved: null };
  }
  return { takenAt: levels.takenAt, byLocation: { [location]: amounts }, placement };
}

/**
 * Доступное к продаже по артикулам одного места. Без `location` — единственное
 * непустое место (кампания ЯМ); если мест несколько, суммы нет — отказ, а не
 * число смешанного склада. null — остатков нет.
 */
export function availableBySku(
  levels: IMarketplaceStockLevels,
  location?: TStockLocation,
): Record<string, number> | null {
  if (levels.error) return null;
  const locations = Object.keys(levels.byLocation) as TStockLocation[];
  const key = location ?? locations[0];
  if (!location && locations.length > 1) {
    throw new Error('Остатки лежат в нескольких местах — укажите место, суммы между ними нет');
  }
  const amounts = key ? levels.byLocation[key] : undefined;
  if (!amounts) return location ? {} : null;
  const result: Record<string, number> = {};
  for (const [sku, amount] of Object.entries(amounts)) result[sku] = amount.available;
  return result;
}
