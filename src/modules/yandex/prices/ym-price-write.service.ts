import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type {
  IMarketplacePriceWriteResult,
  IPriceWriteUpdate,
} from '../../marketplaces/marketplace-adapter';
import type { IPriceSetCurrent } from '../../price-set/price-set.domain';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { assertPrices, skippedPriceWrite, ymDiscountBaseFor } from '../../marketplaces/price-write';
import { batchesOf, writeErrorText } from '../../marketplaces/stock-write';
import { OFFER_PRICES_UPDATE_BATCH } from '../yandex-api.paths';
import { YandexClientFactory } from '../yandex-client.factory';

/**
 * Цены ЯМ для «Установки цен» (TASK-200): чтение текущих и единственная запись
 * цен в Маркет — `POST businesses/{businessId}/offer-prices/updates`, цена
 * бизнеса (во всех магазинах кабинета).
 *
 * Все барьеры записи здесь, по образцу `WbStockWriteService.writeStocks`:
 * `PRICE_WRITE_ENABLED`, целая положительная цена, без повторов. Упавший батч
 * не отменяет следующие — он уходит в `errors`, записанное остаётся.
 */
@Injectable()
export class YmPriceWriteService {
  private readonly logger = new Logger(YmPriceWriteService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly clients: YandexClientFactory,
  ) {}

  /** Цена продажи по артикулам; зачёркнутую план не показывает — она не меняется. */
  async currentPrices(
    store: YandexMarketDocument,
    skus: readonly string[],
  ): Promise<Map<string, IPriceSetCurrent>> {
    const prices = await this.clients.forStore(store).getOfferPrices(skus);
    return new Map([...prices].map(([sku, offer]) => [sku, { price: offer.price }]));
  }

  async writePrices(
    store: YandexMarketDocument,
    updates: readonly IPriceWriteUpdate[],
  ): Promise<IMarketplacePriceWriteResult> {
    if (!this.config.priceWriteEnabled) {
      this.logger.warn(`ЯМ: PRICE_WRITE_ENABLED=false — ${updates.length} цен не записаны`);
      return skippedPriceWrite('write-disabled');
    }
    assertPrices(updates);
    if (!updates.length) return skippedPriceWrite(undefined);

    const client = this.clients.forStore(store);
    // Зачёркнутая — свежая, прямо перед записью: план мог быть построен давно,
    // а продавец за это время поменять скидку в кабинете.
    const current = await client.getOfferPrices(updates.map((update) => update.sku));
    const offers = updates.map((update) => ({
      offerId: update.sku,
      price: update.price,
      discountBase: ymDiscountBaseFor(update.price, current.get(update.sku)?.discountBase),
    }));

    const result: IMarketplacePriceWriteResult = { written: 0, errors: [], skipped: [] };
    for (const [index, batch] of batchesOf(offers, OFFER_PRICES_UPDATE_BATCH).entries()) {
      try {
        await client.updateOfferPrices(batch);
        result.written += batch.length;
      } catch (error) {
        result.errors.push({ batch: index + 1, message: writeErrorText(error) });
      }
    }
    return result;
  }
}
