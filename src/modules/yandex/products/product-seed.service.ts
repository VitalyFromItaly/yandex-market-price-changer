import type { IMatchSummary } from '../../products/product.domain';

import { Injectable, Logger } from '@nestjs/common';

import { ProductService } from '../../../database/services/product.service';
import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { ProductMatchService } from '../../products/product-match.service';
import { productRowsFromCatalog, productRowsFromPriceList } from '../../products/product.domain';
import { YandexClientFactory } from '../yandex-client.factory';

/** Магазин в объёме, нужном для чтения каталога. */
export interface IProductSeedStore {
  telegramUserId: string;
  token: string;
  campaign_id: string;
  business_id: string;
}

/** Итог заполнения — его печатает скрипт. */
export interface IProductSeedSummary {
  priceListRows: number;
  catalogOffers: number;
  fromPriceList: { inserted: number; matched: number };
  fromCatalog: { inserted: number; matched: number };
  productsTotal: number;
  /** Товары каталога со штрихкодом. */
  catalogWithBarcodes: number;
  /** Товары каталога, у которых нет строки прайса, — себестоимость неизвестна. */
  catalogWithoutPurchase: number;
  /** Сопоставление карточек каталога с товарами (TASK-117). */
  match: IMatchSummary;
}

/**
 * Начальное заполнение базы товаров (`Product`) из двух источников: закупа
 * (`PurchasePrice`, наша Mongo) и каталога ЯМ (offer-mappings, только чтение).
 *
 * Объединение, а не пересечение (решение `product_seed_union`): товар каталога
 * без закупа тоже товар, просто его себестоимость неизвестна.
 *
 * Карточки каталога ложатся на товары через сопоставление (`matchCards`,
 * TASK-117): уже привязанные — обновляются, найденные по штрихкоду, артикулу
 * производителя или артикулу — привязываются, без пары — заводят товар,
 * конфликты — в очередь «не сопоставлено». Ручные привязки и отвязки проход
 * не трогает.
 *
 * Идемпотентно: каждый источник пишет только свои поля, и повторный прогон
 * даёт `inserted: 0`.
 */
@Injectable()
export class ProductSeedService {
  private readonly logger = new Logger(ProductSeedService.name);

  constructor(
    private readonly clients: YandexClientFactory,
    private readonly purchasePrices: PurchasePriceService,
    private readonly products: ProductService,
    private readonly matching: ProductMatchService,
  ) {}

  async seed(store: IProductSeedStore): Promise<IProductSeedSummary> {
    const user = store.telegramUserId;

    // Сначала прайс: его название главнее названия карточки, а каталог пишет
    // название только при вставке.
    const priceRows = productRowsFromPriceList(await this.purchasePrices.listForSeed(user));
    const fromPriceList = await this.products.upsertFromPriceList(user, priceRows);

    const offers = await this.clients
      .forTenant({
        token: store.token,
        campaignId: store.campaign_id,
        businessId: store.business_id,
      })
      .loadCatalogProducts();
    const catalogRows = productRowsFromCatalog(offers);
    const synced = await this.matching.syncYmCatalog(user, catalogRows);

    const priced = new Set(priceRows.map((row) => row.sku));
    const summary: IProductSeedSummary = {
      priceListRows: priceRows.length,
      catalogOffers: catalogRows.length,
      fromPriceList,
      fromCatalog: synced.written,
      productsTotal: await this.products.countForUser(user),
      catalogWithBarcodes: catalogRows.filter((row) => row.barcodes.length > 0).length,
      catalogWithoutPurchase: catalogRows.filter((row) => !priced.has(row.sku)).length,
      match: synced.match,
    };

    this.logger.log(`Товары ${user}: заполнено, всего ${summary.productsTotal}`);
    return summary;
  }
}
