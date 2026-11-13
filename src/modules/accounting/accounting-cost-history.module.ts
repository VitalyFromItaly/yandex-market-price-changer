import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';

import { AccountingCostHistoryService } from './accounting-cost-history.service';

/**
 * История закупа v2 «Финучёта» (TASK-213). Свой маленький модуль, а не провайдер
 * `AccountingModule`: её пишет загрузка прайса (`StockSyncService` в `YandexModule`),
 * а `AccountingModule` сам импортирует `YandexModule` — провайдер там дал бы цикл.
 */
@Module({
  imports: [DatabaseModule, PostgresModule],
  providers: [AccountingCostHistoryService],
  exports: [AccountingCostHistoryService],
})
export class AccountingCostHistoryModule {}
