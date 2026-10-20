import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { StockPushModule } from '../../stock-push/stock-push.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmStockPushController } from './crm-stock-push.controller';
import { CrmStockPushKinds } from './crm-stock-push.kinds';

/**
 * «Передача остатков» CRM (TASK-143): kind плана и маршрут записи. Очередь
 * file-processing — из TelegramModule (прецедент «Прайса»).
 */
@Module({
  imports: [
    CrmJobsModule,
    CrmModule,
    DatabaseModule,
    StockPushModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [CrmStockPushController],
  providers: [CrmStockPushKinds],
})
export class CrmStockPushModule {}
