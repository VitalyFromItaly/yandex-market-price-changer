import type { IWbCard, IWbWarehouse } from './wb.client';
import type {
  IMarketplaceStockWriteResult,
  IStockWriteUpdate,
  TStockWriteTarget,
} from '../marketplaces/marketplace-adapter';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import {
  assertStockCounts,
  batchesOf,
  skippedWrite,
  stockWriteTargetOf,
  writeErrorText,
} from '../marketplaces/stock-write';

import { barcodesByVendorCode } from './wb-catalog.service';
import { WbClientFactory } from './wb-client.factory';
import { wbSellerClient } from './wb-seller-client';
import { WB_DELIVERY_TYPE_FBS, WB_STOCKS_BATCH } from './wb.client';

/** Склад записи WB: все склады продавца в счёт, пишется только единственный FBS. */
export function wbStockWriteTarget(warehouses: readonly IWbWarehouse[]): TStockWriteTarget {
  return stockWriteTargetOf(
    warehouses.map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      fbs: warehouse.deliveryType === WB_DELIVERY_TYPE_FBS,
    })),
  );
}

/** Почему позиция WB не отправлялась. */
export const WB_SKIP_REASON = {
  noBarcode: 'нет штрихкода в карточке WB',
  severalSizes: 'несколько размеров — остаток по размерам из прайса не известен',
} as const;

/**
 * Позиции плана → штрихкоды WB (решение `stock_push_wb_single_barcode`): пишется
 * только карточка с ОДНИМ штрихкодом. У многоразмерной прайс знает один остаток
 * на артикул, а WB хранит его по размерам — делить нечем, поэтому её остаток на
 * WB не трогается.
 */
export function wbStockWrites(
  cards: readonly IWbCard[],
  updates: readonly IStockWriteUpdate[],
): {
  writes: { sku: string; barcode: string; amount: number }[];
  skipped: { sku: string; reason: string }[];
} {
  const barcodes = barcodesByVendorCode(cards);
  const writes: { sku: string; barcode: string; amount: number }[] = [];
  const skipped: { sku: string; reason: string }[] = [];
  for (const update of updates) {
    const codes = barcodes.get(update.sku) ?? [];
    if (!codes.length) skipped.push({ sku: update.sku, reason: WB_SKIP_REASON.noBarcode });
    else if (codes.length > 1)
      skipped.push({ sku: update.sku, reason: WB_SKIP_REASON.severalSizes });
    else writes.push({ sku: update.sku, barcode: codes[0], amount: update.count });
  }
  return { writes, skipped };
}

/**
 * Артикулы карточек, которые `wbStockWrites` не отправит, — для плана: то же
 * правило, что у записи, чтобы «Запишем N» и порог обнуления считали только
 * то, что уйдёт в WB.
 */
export function wbUnwritable(cards: readonly IWbCard[]): { sku: string; reason: string }[] {
  const updates = [...barcodesByVendorCode(cards).keys()].map((sku) => ({ sku, count: 0 }));
  return wbStockWrites(cards, updates).skipped;
}

/**
 * Запись остатков FBS в WB (TASK-175). `writeStocks` — единственная функция
 * записи WB, все барьеры внутри: `STOCK_WRITE_ENABLED`, целые количества, склад
 * перечитан и тот же, что в плане. PUT без повторов
 * (`WbClient.updateSellerStocks`). FBW (склады WB) сюда не попадает никогда:
 * пишется только склад продавца из `/api/v3/warehouses` с типом FBS.
 */
@Injectable()
export class WbStockWriteService {
  private readonly logger = new Logger(WbStockWriteService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly clients: WbClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  /** Склад записи и, если он есть, артикулы, которые запись пропустит. */
  async writeTarget(telegramUserId: string): Promise<TStockWriteTarget> {
    const client = await wbSellerClient(this.clients, this.connections, telegramUserId);
    const target = wbStockWriteTarget(await client.listWarehouses());
    if (target.kind !== 'ok') return target;
    return { ...target, unwritable: wbUnwritable(await client.listCards()) };
  }

  async writeStocks(
    telegramUserId: string,
    warehouseId: string,
    updates: readonly IStockWriteUpdate[],
  ): Promise<IMarketplaceStockWriteResult> {
    if (!this.config.stockWriteEnabled) {
      this.logger.warn(`WB: STOCK_WRITE_ENABLED=false — ${updates.length} позиций не записаны`);
      return skippedWrite('write-disabled');
    }
    assertStockCounts(updates);
    if (!updates.length) return skippedWrite(undefined);

    const client = await wbSellerClient(this.clients, this.connections, telegramUserId);
    const target = await client.listWarehouses().then(wbStockWriteTarget, () => null);
    if (target?.kind !== 'ok' || target.warehouse.id !== warehouseId) {
      this.logger.warn(`WB: склад ${warehouseId} больше не единственный FBS — запись отменена`);
      return skippedWrite('placement');
    }

    const { writes, skipped } = wbStockWrites(await client.listCards(), updates);
    const result: IMarketplaceStockWriteResult = { written: 0, errors: [], skipped };
    for (const [index, batch] of batchesOf(writes, WB_STOCKS_BATCH).entries()) {
      try {
        await client.updateSellerStocks(
          warehouseId,
          batch.map((write) => ({ barcode: write.barcode, amount: write.amount })),
        );
        result.written += batch.length;
      } catch (error) {
        result.errors.push({ batch: index + 1, message: writeErrorText(error) });
      }
    }
    return result;
  }
}
