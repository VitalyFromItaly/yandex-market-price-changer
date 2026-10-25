import type { Product } from '../../../database/schemas/product.schema';
import type { TMarketplace } from '../../../shared/marketplace';
import type { MarketplaceRegistry } from '../../marketplaces/marketplace-registry.service';

import { NOT_CONNECTED_TEXT } from '../../inventory/inventory.domain';
import { MarketplaceNotConnectedError } from '../../marketplaces/marketplace-adapter';
import { fbyStockUnavailableLine } from '../../yandex/fby/fby-message';
import { reportErrorMessage } from '../../yandex/reports/report-message';

import { withoutIcon } from './crm-jobs.domain';

/** Остатки магазина ЯМ из контекста задачи — общий помощник площадок (TASK-152). */
export { ymStocks } from '../../marketplaces/ym-stocks';

/** Остатки Ozon/WB по артикулам площадки либо причина, почему их нет. */
export type TMarketplaceAvailable =
  | { available: Record<string, number>; problem: null }
  | { available: null; problem: string };

/**
 * Остатки Ozon/WB для итогов экрана площадки (TASK-183: «Обзор», закупки
 * «Прогноза») — через реестр, только чтение. Места (свой склад FBS и склад
 * площадки) складываются: итог отвечает «сколько товара у продавца на этой
 * площадке», как сумма магазинов FBS и FBY у ЯМ; по местам раздельно — «Склад».
 * Не подключено и сбой — строка причины, а не ноль.
 */
export async function marketplaceAvailable(
  registry: MarketplaceRegistry,
  telegramUserId: string,
  marketplace: TMarketplace,
  now: Date,
): Promise<TMarketplaceAvailable> {
  try {
    const levels = await registry
      .require(marketplace, 'stocks', telegramUserId)
      .listStocks({ telegramUserId, marketplace }, now);
    if (levels.error) {
      return { available: null, problem: withoutIcon(fbyStockUnavailableLine(levels.error)) };
    }
    const available: Record<string, number> = {};
    for (const amounts of Object.values(levels.byLocation)) {
      for (const [sku, amount] of Object.entries(amounts ?? {})) {
        available[sku] = (available[sku] ?? 0) + amount.available;
      }
    }
    return { available, problem: null };
  } catch (error) {
    if (error instanceof MarketplaceNotConnectedError) {
      return { available: null, problem: NOT_CONNECTED_TEXT(marketplace) };
    }
    return { available: null, problem: reportErrorMessage(error) };
  }
}

/**
 * Артикулы площадки → ключ закупа (артикул ЯМ карточки, без неё — свой), штуки
 * складываются. Так ключуются строки журнала, `PurchasePrice` и скорость
 * продаж (`findByJournalSkus`), и остаток Ozon встаёт против своих продаж.
 */
export function byPurchaseKey(
  available: Readonly<Record<string, number>>,
  products: ReadonlyMap<string, Product>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [sku, count] of Object.entries(available)) {
    const key = products.get(sku)?.marketplaceSkus?.ym ?? sku;
    result[key] = (result[key] ?? 0) + count;
  }
  return result;
}
