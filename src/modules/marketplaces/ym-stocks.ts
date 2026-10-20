import type { TMarketplaceStocks } from './marketplace-adapter';
import type { MarketplaceRegistry } from './marketplace-registry.service';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';

/**
 * Остатки магазина ЯМ из контекста задачи — через реестр площадок (TASK-162),
 * а не прямым вызовом адаптера. Магазин называется кампанией: адаптер сам
 * перечитывает документ и сужает его тем же `scopeStore`, так что числа те же,
 * что давал прежний `forStore`. Ответ — наша сущность остатков (TASK-163);
 * доступное по артикулам кампании читается `availableBySku`.
 */
export function ymStocks(
  registry: MarketplaceRegistry,
  store: YandexMarketDocument,
  now: Date,
): Promise<TMarketplaceStocks> {
  const telegramUserId = String(store.telegramUserId ?? '');
  return registry
    .require('ym', 'stocks', telegramUserId)
    .listStocks({ telegramUserId, marketplace: 'ym', campaignId: String(store.campaign_id) }, now);
}
