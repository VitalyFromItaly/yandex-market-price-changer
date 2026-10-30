import type { IWbGoodsPrice } from './wb.client';
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

import { WbClientFactory } from './wb-client.factory';
import { missingCategoriesText } from './wb-connection.domain';
import { wbSellerClient } from './wb-seller-client';
import { WB_PRICES_LIMIT } from './wb.client';
import { WbAuthError } from './wb.errors';

/** Почему позиция WB не отправлялась. */
export const WB_PRICE_SKIP_REASON = {
  notFound: 'нет в ценах WB',
  mixedSizes: 'у размеров разные цены — одна цена на товар их перетёрла бы',
} as const;

/** Текст «нет права» — тот же, что при подключении без категории. */
export const WB_PRICES_NO_ACCESS_TEXT = missingCategoriesText(['prices']);

/**
 * Нет права «Цены и скидки» — понятный текст вместо отказа WB. Право в
 * `WB_REQUIRED_CATEGORIES` не входит (решение `price_set_wb_prices_scope`): без
 * него у продавца работает всё, кроме цен. Наследник `WbAuthError` — в журнале
 * ошибок остаётся источником `wb`, с кодом и requestId исходного отказа.
 */
export class WbPricesAccessError extends WbAuthError {
  constructor(cause: WbAuthError) {
    super(WB_PRICES_NO_ACCESS_TEXT, cause.status, cause.requestId);
    this.request = cause.request;
  }

  public get userMessage(): string {
    return WB_PRICES_NO_ACCESS_TEXT;
  }
}

/** Позиции плана → товары WB по `vendorCode`; товар с разными ценами размеров не пишется. */
export function wbPriceWrites(
  goods: readonly IWbGoodsPrice[],
  updates: readonly IPriceWriteUpdate[],
): {
  writes: { sku: string; nmId: string; price: number }[];
  skipped: { sku: string; reason: string }[];
} {
  const byVendorCode = new Map(goods.map((item) => [item.vendorCode, item]));
  const writes: { sku: string; nmId: string; price: number }[] = [];
  const skipped: { sku: string; reason: string }[] = [];
  for (const update of updates) {
    const item = byVendorCode.get(update.sku);
    if (!item) skipped.push({ sku: update.sku, reason: WB_PRICE_SKIP_REASON.notFound });
    else if (item.mixedSizes)
      skipped.push({ sku: update.sku, reason: WB_PRICE_SKIP_REASON.mixedSizes });
    else writes.push({ sku: update.sku, nmId: item.nmId, price: update.price });
  }
  return { writes, skipped };
}

/**
 * Цены WB для «Установки цен» (TASK-201): чтение текущих и единственная запись
 * цен в WB — `POST discounts-prices-api/api/v2/upload/task`.
 *
 * Все барьеры записи здесь, по образцу `YmPriceWriteService`: `PRICE_WRITE_ENABLED`,
 * целая положительная цена, без повторов (`WbClient.uploadPrices`). Шлётся только
 * базовая цена, скидка продавца не трогается (решение `price_set_keep_discount`).
 * Упавший батч не отменяет следующие — он уходит в `errors`.
 */
@Injectable()
export class WbPriceWriteService {
  private readonly logger = new Logger(WbPriceWriteService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly clients: WbClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  /**
   * Базовая цена и скидка продавца по артикулам (домен считает базовую под
   * скидку). Нет права «Цены и скидки» — `WbPricesAccessError` с понятным текстом.
   */
  async currentPrices(
    telegramUserId: string,
    skus: readonly string[],
  ): Promise<Map<string, IPriceSetCurrent>> {
    const wanted = new Set(skus);
    const goods = await this.goods(telegramUserId);
    return new Map(
      goods
        .filter((item) => wanted.has(item.vendorCode))
        .map((item) => [item.vendorCode, { price: item.price, discount: item.discount }]),
    );
  }

  async writePrices(
    telegramUserId: string,
    updates: readonly IPriceWriteUpdate[],
  ): Promise<IMarketplacePriceWriteResult> {
    if (!this.config.priceWriteEnabled) {
      this.logger.warn(`WB: PRICE_WRITE_ENABLED=false — ${updates.length} цен не записаны`);
      return skippedPriceWrite('write-disabled');
    }
    assertPrices(updates);
    if (!updates.length) return skippedPriceWrite(undefined);

    const client = await wbSellerClient(this.clients, this.connections, telegramUserId);
    let goods: IWbGoodsPrice[];
    try {
      goods = await client.listGoodsPrices();
    } catch (error) {
      if (!(error instanceof WbAuthError)) throw error;
      this.logger.warn(
        `WB: у токена нет права «Цены и скидки» — ${updates.length} цен не записаны`,
      );
      return skippedPriceWrite('no-access');
    }

    const { writes, skipped } = wbPriceWrites(goods, updates);
    const result: IMarketplacePriceWriteResult = { written: 0, errors: [], skipped };
    for (const [index, batch] of batchesOf(writes, WB_PRICES_LIMIT).entries()) {
      try {
        await client.uploadPrices(batch.map((write) => ({ nmId: write.nmId, price: write.price })));
        result.written += batch.length;
      } catch (error) {
        result.errors.push({ batch: index + 1, message: writeErrorText(error) });
      }
    }
    return result;
  }

  private async goods(telegramUserId: string): Promise<IWbGoodsPrice[]> {
    const client = await wbSellerClient(this.clients, this.connections, telegramUserId);
    try {
      return await client.listGoodsPrices();
    } catch (error) {
      // Не тот тип токена — у `WbAuthError` для этого свой текст, он точнее «нет права».
      if (error instanceof WbAuthError && !error.wrongTokenType) {
        throw new WbPricesAccessError(error);
      }
      throw error;
    }
  }
}
