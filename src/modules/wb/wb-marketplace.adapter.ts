import type { IWbStockLevels } from './wb-catalog.service';
import type {
  IMarketplaceAdapter,
  IMarketplaceCallOrigin,
  IMarketplaceCatalog,
  IMarketplaceConnector,
  IMarketplaceFinance,
  IMarketplaceOrderSource,
  IMarketplacePriceWriter,
  IMarketplaceStockLevels,
  IMarketplaceStocks,
  IMarketplaceStockWriter,
  IStockAmount,
} from '../marketplaces/marketplace-adapter';
import type { IConnectionCheck } from '../marketplaces/marketplace-connections.domain';

import { Injectable } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { MarketplaceNotConnectedError } from '../marketplaces/marketplace-adapter';
import { connectionCheckText } from '../marketplaces/marketplace-connections.domain';
import { checkStoredConnection } from '../marketplaces/stored-connection-check';
import { wbCatalogRows } from '../products/product.domain';

import { WbCatalogService } from './wb-catalog.service';
import { WbConnectionService } from './wb-connection.service';
import { WbFinanceService } from './wb-finance.service';
import { WbOrdersService } from './wb-orders.service';
import { WbPriceWriteService } from './wb-price-write.service';
import { WbNotConnectedError } from './wb-seller-client';
import { WbStockWriteService } from './wb-stock-write.service';

/**
 * WB в реестре площадок: подключение (TASK-162), каталог и остатки (TASK-134)
 * поверх `WbCatalogService`, заказы (TASK-135) поверх `WbOrdersService`,
 * отчёт реализации в финжурнал (TASK-136) поверх `WbFinanceService`. Пишет
 * остатки FBS (TASK-175, `WbStockWriteService`) и цены (TASK-201, `WbPriceWriteService`),
 * остальное — чтение.
 */
@Injectable()
export class WbMarketplaceAdapter implements IMarketplaceAdapter {
  readonly marketplace = 'wb' as const;

  constructor(
    private readonly wb: WbConnectionService,
    private readonly connections: MarketplaceConnectionService,
    private readonly wbCatalog: WbCatalogService,
    private readonly wbOrders: WbOrdersService,
    private readonly wbFinance: WbFinanceService,
    private readonly wbStockWrite: WbStockWriteService,
    private readonly wbPriceWrite: WbPriceWriteService,
  ) {}

  readonly connection: IMarketplaceConnector = {
    secretField: 'token',
    check: (telegramUserId, origin) =>
      checkStoredConnection(this.connections, telegramUserId, 'wb', (credentials) =>
        this.verify(telegramUserId, credentials, origin),
      ),
  };

  readonly catalog: IMarketplaceCatalog = {
    listProducts: (ref) =>
      notConnectedAsRegistryError(ref.telegramUserId, async () =>
        wbCatalogRows(await this.wbCatalog.products(ref.telegramUserId)),
      ),
  };

  readonly stocks: IMarketplaceStocks = {
    listStocks: (ref, now = new Date()) =>
      notConnectedAsRegistryError(ref.telegramUserId, async () =>
        wbMarketplaceStocks(await this.wbCatalog.stocks(ref.telegramUserId, now)),
      ),
  };

  /** Запись остатков FBS на единственный склад продавца (TASK-175) — без повторов. */
  readonly stockWrite: IMarketplaceStockWriter = {
    writeTarget: (ref) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.wbStockWrite.writeTarget(ref.telegramUserId),
      ),
    writeStocks: (ref, warehouseId, updates) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.wbStockWrite.writeStocks(ref.telegramUserId, warehouseId, updates),
      ),
  };

  /** Цены «Установки цен» (TASK-201): чтение текущих и запись без повторов. */
  readonly priceWrite: IMarketplacePriceWriter = {
    currentPrices: (ref, skus) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.wbPriceWrite.currentPrices(ref.telegramUserId, skus),
      ),
    writePrices: (ref, updates) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.wbPriceWrite.writePrices(ref.telegramUserId, updates),
      ),
  };

  readonly orders: IMarketplaceOrderSource = {
    listOrders: (ref, period, now = new Date()) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.wbOrders.listOrders(ref.telegramUserId, period, now),
      ),
  };

  readonly finance: IMarketplaceFinance = {
    importFinance: (ref, period) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.wbFinance.importPeriod(ref.telegramUserId, period),
      ),
  };

  private async verify(
    telegramUserId: string,
    credentials: Record<string, string>,
    origin: IMarketplaceCallOrigin,
  ): Promise<IConnectionCheck> {
    const result = await this.wb.verify(credentials.token, { telegramUserId, ...origin });
    if (result.ok === true) return { status: 'ok', message: connectionCheckText('wb', 'ok') };
    if (result.reason === 'unavailable') {
      return { status: 'unavailable', message: connectionCheckText('wb', 'unavailable') };
    }
    // Нет категорий — ключ работает, но читать им нужное нечем: тот же исход, что «без ролей».
    return { status: result.reason === 'auth' ? 'rejected' : 'empty', message: result.message };
  }
}

/**
 * Остатки WB → наша сущность. FBW — склад WB (`marketplace`), FBS — склад
 * продавца (`seller`), раздельно и без суммы. Резерв WB отдельным числом не
 * сообщает — `reserved: null`, как у ЯМ.
 */
export function wbMarketplaceStocks(levels: IWbStockLevels): IMarketplaceStockLevels {
  const marketplace: Record<string, IStockAmount> = {};
  const seller: Record<string, IStockAmount> = {};
  for (const [sku, stock] of Object.entries(levels.stocks)) {
    marketplace[sku] = { available: stock.fbw, reserved: null };
    seller[sku] = { available: stock.fbs, reserved: null };
  }
  return { takenAt: levels.takenAt, byLocation: { marketplace, seller }, placement: null };
}

/** Нет токена — тот же отказ реестра, что у ЯМ и Ozon. */
async function notConnectedAsRegistryError<T>(
  telegramUserId: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof WbNotConnectedError) {
      throw new MarketplaceNotConnectedError('wb', telegramUserId, 'no-credentials');
    }
    throw error;
  }
}
