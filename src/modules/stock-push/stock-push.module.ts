import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';
import { ProductsModule } from '../products/products.module';
import { YandexModule } from '../yandex/yandex.module';

import { CatalogLinkService } from './catalog-link.service';
import { StockPushService } from './stock-push.service';

/**
 * «Передача остатков» (TASK-143). Отдельный модуль, потому что его зовут и
 * CRM (план), и процессор file-processing (запись): TelegramModule не должен
 * тянуть CRM, а CRM — граф бота.
 */
@Module({
  imports: [DatabaseModule, MarketplacesModule, ProductsModule, YandexModule],
  providers: [StockPushService, CatalogLinkService],
  exports: [StockPushService, CatalogLinkService],
})
export class StockPushModule {}
