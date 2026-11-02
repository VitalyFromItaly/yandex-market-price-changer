import type { IOzonProduct, IOzonWarehouse } from './ozon.client';
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

import { OzonClientFactory } from './ozon-client.factory';
import { ozonSellerClient } from './ozon-seller-client';
import { OZON_STOCKS_WRITE_BATCH } from './ozon.client';

/** Склад в архиве Ozon — не рабочий и в правило «один склад» не входит. */
const OZON_ARCHIVED_STATUS = 'disabled';
/** Рабочий склад Ozon; `new`, `blocked`, пауза по лимиту — писать нельзя. */
const OZON_WORKING_STATUS = 'created';

/**
 * Склад записи Ozon. Склады FBS и rFBS — оба склады продавца; в архиве — не в
 * счёт. Единственный склад пишется, только если он рабочий: незнакомый статус =
 * писать некуда (неизвестное = запрещено).
 */
export function ozonStockWriteTarget(warehouses: readonly IOzonWarehouse[]): TStockWriteTarget {
  return stockWriteTargetOf(
    warehouses
      .filter((warehouse) => warehouse.status !== OZON_ARCHIVED_STATUS)
      .map((warehouse) => ({
        id: warehouse.id,
        name: warehouse.name,
        fbs: warehouse.status === OZON_WORKING_STATUS,
      })),
  );
}

/** Почему Ozon не примет остаток позиции — продавцу на экране «Передача остатков». */
export const OZON_SKIP_REASON = {
  notCreated: 'карточка на Ozon не создана — остаток не принимается',
} as const;

/**
 * Артикулы, которые Ozon заведомо отвергнет, — для плана. Карточка не создана
 * (`is_created: false`) — Ozon отвечает `PRODUCT_IS_NOT_CREATED`; без отсева она
 * каждый проход снова в плане и снова поднимает алерт (прод 406937947, «ABW TOP»,
 * 10 позиций). Поле не пришло — позиция пишется: неизвестное здесь не повод молчать.
 */
export function ozonUnwritable(
  products: readonly IOzonProduct[],
): { sku: string; reason: string }[] {
  return products
    .filter((product) => product.created === false && product.offerId)
    .map((product) => ({ sku: product.offerId, reason: OZON_SKIP_REASON.notCreated }));
}

/**
 * Запись остатков FBS в Ozon (TASK-175). `writeStocks` — единственная функция
 * записи Ozon, все барьеры внутри: `STOCK_WRITE_ENABLED`, целые количества,
 * склад перечитан и тот же, что в плане. Запросы записи — без повторов
 * (`OzonSellerClient.updateStocks`). FBO (склад Ozon) сюда не попадает никогда:
 * пишется только склад из `/v2/warehouse/list` — это склады продавца.
 */
@Injectable()
export class OzonStockWriteService {
  private readonly logger = new Logger(OzonStockWriteService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  /** Склад записи и, если он есть, артикулы, которые Ozon не примет. */
  async writeTarget(telegramUserId: string): Promise<TStockWriteTarget> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const target = ozonStockWriteTarget(await client.listWarehouses());
    if (target.kind !== 'ok') return target;
    // Каталог не прочитался — пишем как раньше: отказ Ozon по позиции и так виден в алерте.
    const products = await client.listProducts().catch((error: unknown) => {
      this.logger.warn(`Ozon: каталог для отсева не прочитался — ${writeErrorText(error)}`);
      return [];
    });
    const unwritable = ozonUnwritable(products);
    return unwritable.length ? { ...target, unwritable } : target;
  }

  async writeStocks(
    telegramUserId: string,
    warehouseId: string,
    updates: readonly IStockWriteUpdate[],
  ): Promise<IMarketplaceStockWriteResult> {
    if (!this.config.stockWriteEnabled) {
      this.logger.warn(`Ozon: STOCK_WRITE_ENABLED=false — ${updates.length} позиций не записаны`);
      return skippedWrite('write-disabled');
    }
    assertStockCounts(updates);
    if (!updates.length) return skippedWrite(undefined);

    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const target = await client.listWarehouses().then(ozonStockWriteTarget, () => null);
    if (target?.kind !== 'ok' || target.warehouse.id !== warehouseId) {
      this.logger.warn(
        `Ozon: склад ${warehouseId} больше не единственный рабочий — запись отменена`,
      );
      return skippedWrite('placement');
    }

    const result: IMarketplaceStockWriteResult = { written: 0, errors: [], skipped: [] };
    const batches = batchesOf(updates, OZON_STOCKS_WRITE_BATCH);
    for (const [index, batch] of batches.entries()) {
      try {
        const rows = await client.updateStocks(
          warehouseId,
          batch.map((update) => ({ offerId: update.sku, stock: update.count })),
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
