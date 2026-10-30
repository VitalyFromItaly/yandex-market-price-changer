import type {
  IMarketplacePriceWriteResult,
  IPriceWriteUpdate,
} from '../marketplaces/marketplace-adapter';
import type { IPriceSetCurrent } from '../price-set/price-set.domain';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { assertPrices, skippedPriceWrite } from '../marketplaces/price-write';
import { batchesOf, writeErrorText } from '../marketplaces/stock-write';

import { OzonClientFactory } from './ozon-client.factory';
import { ozonSellerClient } from './ozon-seller-client';
import { OZON_PRICES_BATCH } from './ozon.client';

/**
 * Цены Ozon для «Установки цен» (TASK-201): чтение текущих и единственная запись
 * цен в Ozon — `POST /v1/product/import/prices`.
 *
 * Все барьеры записи здесь, по образцу `YmPriceWriteService`: `PRICE_WRITE_ENABLED`,
 * целая положительная цена, без повторов (`OzonSellerClient.updatePrices`).
 * `old_price` не шлётся (решение `price_set_keep_discount`). Упавший батч не
 * отменяет следующие — он уходит в `errors`, записанное остаётся.
 */
@Injectable()
export class OzonPriceWriteService {
  private readonly logger = new Logger(OzonPriceWriteService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  /** Цена продажи по артикулам; артикула нет в карте — нет в каталоге Ozon. */
  async currentPrices(
    telegramUserId: string,
    skus: readonly string[],
  ): Promise<Map<string, IPriceSetCurrent>> {
    if (!skus.length) return new Map();
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const prices = await client.getPrices(skus);
    return new Map(prices.map((item) => [item.offerId, { price: item.price }]));
  }

  async writePrices(
    telegramUserId: string,
    updates: readonly IPriceWriteUpdate[],
  ): Promise<IMarketplacePriceWriteResult> {
    if (!this.config.priceWriteEnabled) {
      this.logger.warn(`Ozon: PRICE_WRITE_ENABLED=false — ${updates.length} цен не записаны`);
      return skippedPriceWrite('write-disabled');
    }
    assertPrices(updates);
    if (!updates.length) return skippedPriceWrite(undefined);

    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const result: IMarketplacePriceWriteResult = { written: 0, errors: [], skipped: [] };
    for (const [index, batch] of batchesOf(updates, OZON_PRICES_BATCH).entries()) {
      try {
        const rows = await client.updatePrices(
          batch.map((update) => ({ offerId: update.sku, price: update.price })),
        );
        const confirmed = new Set(rows.filter((row) => row.updated).map((row) => row.offerId));
        result.written += batch.filter((update) => confirmed.has(update.sku)).length;
        const failed = batch.filter((update) => !confirmed.has(update.sku));
        if (failed.length) {
          const reasons = new Map(rows.map((row) => [row.offerId, row.message]));
          result.errors.push({
            batch: index + 1,
            message: failed
              .map((update) => `${update.sku}: ${reasons.get(update.sku) ?? 'нет в ответе Ozon'}`)
              .join('; '),
          });
        }
      } catch (error) {
        result.errors.push({ batch: index + 1, message: writeErrorText(error) });
      }
    }
    return result;
  }
}
