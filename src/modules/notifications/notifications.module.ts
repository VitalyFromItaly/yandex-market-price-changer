import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';

import { NotificationsService } from './notifications.service';

/** Правила уведомлений продавцу (TASK-152): проверка; доставку делают очередь бота и CRM. */
@Module({
  imports: [DatabaseModule, PostgresModule, FinanceModule, InventoryModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
