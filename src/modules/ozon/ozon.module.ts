import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';
import { FinanceModule } from '../finance/finance.module';

import { OzonCatalogService } from './ozon-catalog.service';
import { OzonClientFactory } from './ozon-client.factory';
import { OzonConnectionService } from './ozon-connection.service';
import { OzonFinanceService } from './ozon-finance.service';
import { OzonMarketplaceAdapter } from './ozon-marketplace.adapter';
import { OzonOrdersService } from './ozon-orders.service';
import { OzonPriceWriteService } from './ozon-price-write.service';
import { OzonStockWriteService } from './ozon-stock-write.service';

/**
 * Ozon Seller API (M19): клиент и подключение ключа (TASK-128), каталог и
 * остатки (TASK-129), отправления (TASK-130), финансовые операции (TASK-131).
 *
 * AppConfigService и ErrorReporter приходят сами: их модули глобальные.
 * DatabaseModule — ради MarketplaceConnectionService и товаров. FinanceModule —
 * ради общей записи журнала (`FinanceImportService`); обратного импорта нет:
 * финансы до Ozon не дотягиваются (тест границ). PostgresModule — ради раскладки
 * выплат по строкам журнала (TASK-184). `OzonMarketplaceAdapter` —
 * часть Ozon в реестре площадок (TASK-162), регистрирует его MarketplacesModule.
 */
@Module({
  imports: [DatabaseModule, PostgresModule, FinanceModule],
  providers: [
    OzonClientFactory,
    OzonConnectionService,
    OzonCatalogService,
    OzonOrdersService,
    OzonFinanceService,
    OzonStockWriteService,
    OzonPriceWriteService,
    OzonMarketplaceAdapter,
  ],
  exports: [OzonClientFactory, OzonConnectionService, OzonCatalogService, OzonMarketplaceAdapter],
})
export class OzonModule {}
