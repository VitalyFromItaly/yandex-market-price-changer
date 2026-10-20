import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { FinanceModule } from '../finance/finance.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';
import { ProductsModule } from '../products/products.module';
import { YandexModule } from '../yandex/yandex.module';

import { InventoryService } from './inventory.service';

/** Сборка склада — общая для CRM «Склад» и правил уведомлений (TASK-152). */
@Module({
  imports: [DatabaseModule, FinanceModule, MarketplacesModule, ProductsModule, YandexModule],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
