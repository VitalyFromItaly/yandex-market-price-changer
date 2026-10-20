import type { IOzonProduct, IOzonStock, IOzonStockAmount, OzonSellerClient } from './ozon.client';

import { Injectable } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';

import { OzonClientFactory } from './ozon-client.factory';
import { ozonSellerClient } from './ozon-seller-client';

// Перенесена в ozon-seller-client.ts (её бросают и заказы); реэкспорт — для прежних импортов.
export { OzonNotConnectedError } from './ozon-seller-client';

/**
 * Остатки продавца на Ozon по артикулу (`offer_id`). FBO и FBS — раздельно и
 * без суммы: FBO лежит на складе Ozon, FBS — у продавца, и общее число
 * смешало бы чужой склад со своим (довод FBY read-only).
 */
export interface IOzonStockLevels {
  takenAt: Date;
  stocks: Record<string, { fbo: IOzonStockAmount; fbs: IOzonStockAmount }>;
}

/**
 * Каталог и остатки Ozon (TASK-129) — только чтение, в Ozon ничего не пишется.
 *
 * Ключ читается из `MarketplaceConnection` на каждый вызов: свежий, и только
 * через `credentialsOf` (правило TASK-127). Адаптер площадки отложен до
 * TASK-131 (решение `ozon_adapter_after_finance`): сессия обязана уметь заказы
 * и финансы, а заглушка «не реализовано» — ловушка для ночной загрузки.
 */
@Injectable()
export class OzonCatalogService {
  constructor(
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  async products(telegramUserId: string): Promise<IOzonProduct[]> {
    return await (await this.clientFor(telegramUserId)).listProducts();
  }

  async stocks(telegramUserId: string, now: Date = new Date()): Promise<IOzonStockLevels> {
    const rows = await (await this.clientFor(telegramUserId)).loadStocks();
    return { takenAt: now, stocks: ozonStockLevels(rows) };
  }

  private clientFor(telegramUserId: string): Promise<OzonSellerClient> {
    return ozonSellerClient(this.clients, this.connections, telegramUserId);
  }
}

/** Строки остатков → карта по offer_id. Повтор артикула складывается по типу склада. */
export function ozonStockLevels(rows: readonly IOzonStock[]): IOzonStockLevels['stocks'] {
  const stocks: IOzonStockLevels['stocks'] = {};
  for (const row of rows) {
    const sku = row.offerId?.trim();
    if (!sku) continue;
    const current = (stocks[sku] ??= {
      fbo: { present: 0, reserved: 0 },
      fbs: { present: 0, reserved: 0 },
    });
    for (const type of ['fbo', 'fbs'] as const) {
      current[type].present += row[type].present;
      current[type].reserved += row[type].reserved;
    }
  }
  return stocks;
}
