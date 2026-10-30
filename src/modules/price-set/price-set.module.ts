import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';

import { PriceSetService } from './price-set.service';

/**
 * «Установка цен» (TASK-202). Отдельный модуль, потому что его зовут и CRM
 * (план), и процессор file-processing (запись): TelegramModule не должен тянуть
 * CRM, а CRM — граф бота (прецедент `StockPushModule`).
 */
@Module({
  imports: [DatabaseModule, MarketplacesModule],
  providers: [PriceSetService],
  exports: [PriceSetService],
})
export class PriceSetModule {}
