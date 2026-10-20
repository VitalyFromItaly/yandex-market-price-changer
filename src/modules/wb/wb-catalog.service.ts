import type { IWbCard, IWbSellerStock, IWbStockRow, WbClient } from './wb.client';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';

import { WbClientFactory } from './wb-client.factory';
import { wbSellerClient } from './wb-seller-client';

/**
 * Остатки продавца на WB по артикулу (`vendorCode`). FBW и FBS — раздельно и
 * без суммы: FBW лежит на складе WB, FBS — у продавца, и общее число смешало
 * бы чужой склад со своим (довод FBY read-only).
 */
export interface IWbStockLevels {
  takenAt: Date;
  stocks: Record<string, { fbw: number; fbs: number }>;
  /** Строк FBS, чей штрихкод не нашёлся в карточках: их артикул неизвестен. */
  unknownBarcodes: number;
}

/**
 * Каталог и остатки WB (TASK-134) — только чтение. Запись остатков — отдельно,
 * `WbStockWriteService` (TASK-175).
 * Токен читается из `MarketplaceConnection` на каждый вызов.
 */
@Injectable()
export class WbCatalogService {
  private readonly logger = new Logger(WbCatalogService.name);

  constructor(
    private readonly clients: WbClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  async products(telegramUserId: string): Promise<IWbCard[]> {
    return await (await this.clientFor(telegramUserId)).listCards();
  }

  /**
   * FBW — отчёт «Статистики» по складам WB, FBS — склады продавца по штрихкодам.
   * Штрихкоды берутся из карточек: другого списка у WB нет, а склад продавца
   * отвечает только на заданные.
   */
  async stocks(telegramUserId: string, now: Date = new Date()): Promise<IWbStockLevels> {
    const client = await this.clientFor(telegramUserId);
    const cards = await client.listCards();
    const fbw = await client.loadWbStocks();
    const barcodes = [...new Set(cards.flatMap((card) => card.sizes.flatMap((s) => s.barcodes)))];
    const fbs: IWbSellerStock[] = [];
    if (barcodes.length) {
      for (const warehouse of await client.listWarehouses()) {
        fbs.push(...(await client.loadSellerStocks(warehouse.id, barcodes)));
      }
    }
    const levels = wbStockLevels(cards, fbw, fbs, now);
    if (levels.unknownBarcodes) {
      this.logger.warn(`WB: ${levels.unknownBarcodes} строк FBS без карточки — не учтены`);
    }
    return levels;
  }

  private clientFor(telegramUserId: string): Promise<WbClient> {
    return wbSellerClient(this.clients, this.connections, telegramUserId);
  }
}

/**
 * Артикул (`vendorCode`) → его штрихкоды по всем размерам, без повторов. Запись
 * остатков WB (TASK-175) пишет только артикул с одним штрихкодом.
 */
export function barcodesByVendorCode(cards: readonly IWbCard[]): Map<string, string[]> {
  const byCode = new Map<string, Set<string>>();
  for (const card of cards) {
    const sku = card.vendorCode.trim();
    if (!sku) continue;
    const codes = byCode.get(sku) ?? new Set<string>();
    for (const size of card.sizes) for (const code of size.barcodes) if (code) codes.add(code);
    byCode.set(sku, codes);
  }
  return new Map([...byCode].map(([sku, codes]) => [sku, [...codes]]));
}

/**
 * Остатки → карта по `vendorCode`. FBW уже несёт артикул, FBS — только
 * штрихкод, он переводится по карточкам. Размеры и склады одного места
 * складываются, FBW с FBS — никогда.
 */
export function wbStockLevels(
  cards: readonly IWbCard[],
  fbwRows: readonly IWbStockRow[],
  sellerRows: readonly IWbSellerStock[],
  now: Date,
): IWbStockLevels {
  const skuOfBarcode = new Map<string, string>();
  for (const card of cards) {
    const sku = card.vendorCode.trim();
    if (!sku) continue;
    for (const size of card.sizes) for (const code of size.barcodes) skuOfBarcode.set(code, sku);
  }

  const stocks: IWbStockLevels['stocks'] = {};
  const entry = (sku: string) => (stocks[sku] ??= { fbw: 0, fbs: 0 });

  for (const row of fbwRows) {
    const sku = row.supplierArticle || skuOfBarcode.get(row.barcode);
    if (sku) entry(sku).fbw += row.quantity;
  }
  let unknownBarcodes = 0;
  for (const row of sellerRows) {
    const sku = skuOfBarcode.get(row.barcode);
    if (sku) entry(sku).fbs += row.amount;
    else unknownBarcodes += 1;
  }
  return { takenAt: now, stocks, unknownBarcodes };
}
