import type {
  IMarketplaceAdapter,
  IMarketplaceCatalog,
  IMarketplaceConnectionRef,
  IMarketplaceFinance,
  IMarketplaceOrderSource,
  IMarketplacePriceWriter,
  IMarketplaceStocks,
} from './marketplace-adapter';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { YandexMarketService } from '../../database/services/yandex-market.service';
import { FinanceImportService } from '../finance/finance-import.service';
import { productRowsFromCatalog } from '../products/product.domain';
import { YmPriceWriteService } from '../yandex/prices/ym-price-write.service';
import { OrderReportsService } from '../yandex/reports/order-reports.service';
import { placementOfCampaign } from '../yandex/stocks/placement';
import { StockLevelsService } from '../yandex/stocks/stock-levels.service';
import { scopeStore } from '../yandex/stores/stores.domain';
import { YandexClientFactory } from '../yandex/yandex-client.factory';

import { MarketplaceNotConnectedError } from './marketplace-adapter';
import { ymStockLevels } from './marketplace-stocks';
import { ymMarketplaceOrder } from './ym-orders';

/**
 * Адаптер Яндекс Маркета — ЧИСТАЯ делегация к сервисам, которые зовут бот и
 * CRM. Ни одного числа здесь не считается: «ЯМ через адаптер» обязан давать
 * ровно те же заказы, журнал, каталог и остатки, что и прямой вызов, и тест
 * пиннит это сравнением с обёрнутым сервисом. Каталог и остатки переводятся в
 * наши сущности (TASK-163) — `productRowsFromCatalog` и `ymStockLevels`, заказы
 * (TASK-130) — `ymMarketplaceOrder`; числа при этом те же.
 *
 * Креды — из `YandexMarket` (решение `marketplace_connection_ym_virtual`),
 * перечитываются на каждый вопрос: потребитель задаёт один. Импорту финансов
 * документ не нужен вовсе (сервис ищет магазин сам).
 *
 * Подключение ЯМ — отдельная часть, `YmConnectionAdapter`: ему нужен только
 * `StoresService`, и тесту «Подключений» незачем тянуть отчёты и финансы.
 */
@Injectable()
export class YmMarketplaceAdapter implements IMarketplaceAdapter {
  readonly marketplace = 'ym' as const;

  constructor(
    private readonly stores: YandexMarketService,
    private readonly reports: OrderReportsService,
    private readonly financeImport: FinanceImportService,
    private readonly stockLevels: StockLevelsService,
    private readonly clients: YandexClientFactory,
    private readonly prices: YmPriceWriteService,
  ) {}

  readonly finance: IMarketplaceFinance = {
    importFinance: (ref, period) =>
      this.financeImport.importAndRecord({ telegramUserId: ref.telegramUserId, period }),
  };

  readonly orders: IMarketplaceOrderSource = {
    listOrders: async (ref, period, now = new Date()) => {
      const store = await this.loadStore(ref);
      const placed = await this.reports.collectPlacedOrders(store, period, now);
      const scheme = placementOfCampaign(store.stores, store.campaign_id) ?? null;
      return {
        orders: placed.orders.map((order) => ymMarketplaceOrder(order, scheme)),
        cancelled: placed.cancelled.map((order) => ymMarketplaceOrder(order, scheme)),
      };
    },
  };

  readonly catalog: IMarketplaceCatalog = {
    listProducts: async (ref) =>
      productRowsFromCatalog(
        await this.clients.forStore(await this.loadStore(ref)).loadCatalogProducts(),
      ),
  };

  readonly stocks: IMarketplaceStocks = {
    listStocks: async (ref, now = new Date()) =>
      ymStockLevels(await this.stockLevels.levels(await this.loadStore(ref), now)),
  };

  /** Цена ЯМ — бизнесовая: магазин из ref даёт только креды кабинета. */
  readonly priceWrite: IMarketplacePriceWriter = {
    currentPrices: async (ref, skus) => this.prices.currentPrices(await this.loadStore(ref), skus),
    writePrices: async (ref, updates) =>
      this.prices.writePrices(await this.loadStore(ref), updates),
  };

  private async loadStore(ref: IMarketplaceConnectionRef): Promise<YandexMarketDocument> {
    const doc = await this.stores.findByTelegramUser(ref.telegramUserId);
    if (!doc?.token || !doc.campaign_id || !doc.business_id) {
      throw new MarketplaceNotConnectedError('ym', ref.telegramUserId, 'no-credentials');
    }
    if (!ref.campaignId) return doc;

    // Кампания, которой нет в кэше магазинов токена, не открывается — то же
    // правило доступа, что у магазина из адреса CRM.
    const scoped = scopeStore(doc, ref.campaignId);
    // Активный магазин бота открыт всегда, даже у старого документа без кэша
    // `stores` — kind-ы CRM передают кампанию и для него (`accountStores`).
    if (!scoped && ref.campaignId === String(doc.campaign_id)) return doc;
    if (!scoped) throw new MarketplaceNotConnectedError('ym', ref.telegramUserId, 'no-credentials');
    return scoped;
  }
}
