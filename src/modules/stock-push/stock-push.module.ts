import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';
import { YandexModule } from '../yandex/yandex.module';

import { StockPushService } from './stock-push.service';

/**
 * «Передача остатков» (TASK-143). Отдельный модуль, потому что его зовут и
 * CRM (план), и процессор file-processing (запись): TelegramModule не должен
 * тянуть CRM, а CRM — граф бота.
 */
@Module({
  imports: [DatabaseModule, MarketplacesModule, YandexModule],
  providers: [StockPushService],
  exports: [StockPushService],
})
export class StockPushModule {}
