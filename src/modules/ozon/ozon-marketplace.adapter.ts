import type { IOzonStockLevels } from './ozon-catalog.service';
import type { IOzonStockAmount } from './ozon.client';
import type {
  IMarketplaceAdapter,
  IMarketplaceCallOrigin,
  IMarketplaceCatalog,
  IMarketplaceConnector,
  IMarketplaceFinance,
  IMarketplaceOrderSource,
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
import { ozonCatalogRows } from '../products/product.domain';

import { OzonCatalogService } from './ozon-catalog.service';
import { OzonConnectionService } from './ozon-connection.service';
import { OzonFinanceService } from './ozon-finance.service';
import { OzonOrdersService } from './ozon-orders.service';
import { OzonNotConnectedError } from './ozon-seller-client';
import { OzonStockWriteService } from './ozon-stock-write.service';

/**
 * Ozon в реестре площадок: подключение (TASK-162), каталог и остатки
 * (TASK-163) поверх `OzonCatalogService`, заказы — отправления FBS и FBO
 * (TASK-130) поверх `OzonOrdersService`, финансовые операции (TASK-131)
 * поверх `OzonFinanceService` — журнал Postgres. Пишет только запись остатков
 * FBS (TASK-175, `OzonStockWriteService`), остальное — чтение.
 *
 * `ref.campaignId` не читается: у Ozon один кабинет на ключ.
 */
@Injectable()
export class OzonMarketplaceAdapter implements IMarketplaceAdapter {
  readonly marketplace = 'ozon' as const;

  constructor(
    private readonly ozon: OzonConnectionService,
    private readonly connections: MarketplaceConnectionService,
    private readonly ozonCatalog: OzonCatalogService,
    private readonly ozonOrders: OzonOrdersService,
    private readonly ozonFinance: OzonFinanceService,
    private readonly ozonStockWrite: OzonStockWriteService,
  ) {}

  readonly connection: IMarketplaceConnector = {
    secretField: 'apiKey',
    check: (telegramUserId, origin) =>
      checkStoredConnection(this.connections, telegramUserId, 'ozon', (credentials) =>
        this.verify(telegramUserId, credentials, origin),
      ),
  };

  readonly catalog: IMarketplaceCatalog = {
    listProducts: (ref) =>
      notConnectedAsRegistryError(ref.telegramUserId, async () =>
        ozonCatalogRows(await this.ozonCatalog.products(ref.telegramUserId)),
      ),
  };

  /** Запись остатков FBS на единственный склад продавца (TASK-175) — без повторов. */
  readonly stockWrite: IMarketplaceStockWriter = {
    writeTarget: (ref) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.ozonStockWrite.writeTarget(ref.telegramUserId),
      ),
    writeStocks: (ref, warehouseId, updates) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.ozonStockWrite.writeStocks(ref.telegramUserId, warehouseId, updates),
      ),
  };

  readonly orders: IMarketplaceOrderSource = {
    listOrders: (ref, period, now = new Date()) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.ozonOrders.listOrders(ref.telegramUserId, period, now),
      ),
  };

  readonly finance: IMarketplaceFinance = {
    importFinance: (ref, period) =>
      notConnectedAsRegistryError(ref.telegramUserId, () =>
        this.ozonFinance.importPeriod(ref.telegramUserId, period),
      ),
  };

  readonly stocks: IMarketplaceStocks = {
    listStocks: (ref, now = new Date()) =>
      notConnectedAsRegistryError(ref.telegramUserId, async () =>
        ozonMarketplaceStocks(await this.ozonCatalog.stocks(ref.telegramUserId, now)),
      ),
  };

  private async verify(
    telegramUserId: string,
    credentials: Record<string, string>,
    origin: IMarketplaceCallOrigin,
  ): Promise<IConnectionCheck> {
    const result = await this.ozon.verify(
      { clientId: credentials.clientId, apiKey: credentials.apiKey },
      { telegramUserId, ...origin },
    );
    if (result.ok === true) return { status: 'ok', message: connectionCheckText('ozon', 'ok') };
    if (result.reason === 'auth') return { status: 'rejected', message: result.message };
    return { status: result.reason, message: connectionCheckText('ozon', result.reason) };
  }
}

/**
 * Остатки Ozon → наша сущность (TASK-163). FBO — склад Ozon (`marketplace`),
 * FBS — склад продавца (`seller`), раздельно и без суммы. У Ozon `present` —
 * всё, что лежит, вместе с резервом, поэтому доступно = present − reserved.
 */
export function ozonMarketplaceStocks(levels: IOzonStockLevels): IMarketplaceStockLevels {
  const marketplace: Record<string, IStockAmount> = {};
  const seller: Record<string, IStockAmount> = {};
  for (const [sku, stock] of Object.entries(levels.stocks)) {
    marketplace[sku] = ozonAmount(stock.fbo);
    seller[sku] = ozonAmount(stock.fbs);
  }
  return { takenAt: levels.takenAt, byLocation: { marketplace, seller }, placement: null };
}

function ozonAmount(amount: IOzonStockAmount): IStockAmount {
  return { available: Math.max(0, amount.present - amount.reserved), reserved: amount.reserved };
}

/** Нет ключа — тот же отказ реестра, что у ЯМ: вызывающий различает «нечего спрашивать» и сбой. */
async function notConnectedAsRegistryError<T>(
  telegramUserId: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof OzonNotConnectedError) {
      throw new MarketplaceNotConnectedError('ozon', telegramUserId, 'no-credentials');
    }
    throw error;
  }
}
