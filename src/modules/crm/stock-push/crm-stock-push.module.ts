import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { OzonModule } from '../../ozon/ozon.module';
import { StockPushModule } from '../../stock-push/stock-push.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmStockPushScheduleController } from './crm-stock-push-schedule.controller';
import { CrmStockPushController } from './crm-stock-push.controller';
import { CrmStockPushKinds } from './crm-stock-push.kinds';

/**
 * «Передача остатков» CRM (TASK-143): kind плана, маршрут записи и частота
 * синхронизации. Очередь file-processing и планировщик — из TelegramModule
 * (прецедент «Прайса»).
 */
@Module({
  imports: [
    CrmJobsModule,
    CrmModule,
    DatabaseModule,
    OzonModule,
    StockPushModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [CrmStockPushController, CrmStockPushScheduleController],
  providers: [CrmStockPushKinds],
})
export class CrmStockPushModule {}
