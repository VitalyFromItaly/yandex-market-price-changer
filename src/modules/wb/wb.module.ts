import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { FinanceModule } from '../finance/finance.module';

import { WbCatalogService } from './wb-catalog.service';
import { WbClientFactory } from './wb-client.factory';
import { WbConnectionService } from './wb-connection.service';
import { WbFinanceService } from './wb-finance.service';
import { WbMarketplaceAdapter } from './wb-marketplace.adapter';
import { WbOrdersService } from './wb-orders.service';
import { WbStockWriteService } from './wb-stock-write.service';

/**
 * Wildberries API (M20): клиент и подключение токена (TASK-133), каталог и
 * остатки (TASK-134), заказы (TASK-135), отчёт реализации в финжурнал (TASK-136).
 *
 * ErrorReporter приходит сам (глобальный модуль), DatabaseModule — ради
 * MarketplaceConnectionService и товаров, FinanceModule — ради
 * FinanceImportService (как у Ozon: всё, что поднимает WB, требует POSTGRES_URL).
 */
@Module({
  imports: [DatabaseModule, FinanceModule],
  providers: [
    WbClientFactory,
    WbConnectionService,
    WbCatalogService,
    WbOrdersService,
    WbFinanceService,
    WbStockWriteService,
    WbMarketplaceAdapter,
  ],
  exports: [
    WbClientFactory,
    WbConnectionService,
    WbCatalogService,
    WbOrdersService,
    WbFinanceService,
    WbMarketplaceAdapter,
  ],
})
export class WbModule {}
