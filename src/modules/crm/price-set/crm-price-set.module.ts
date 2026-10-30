import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { PriceSetModule } from '../../price-set/price-set.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmPriceSetController } from './crm-price-set.controller';
import { CrmPriceSetKinds } from './crm-price-set.kinds';

/**
 * «Установка цен» CRM (TASK-202): kind плана, загрузка файла и маршрут записи.
 * Очереди crm-jobs и file-processing — из TelegramModule (прецедент «Прайса»).
 */
@Module({
  imports: [
    CrmJobsModule,
    CrmModule,
    DatabaseModule,
    PriceSetModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [CrmPriceSetController],
  providers: [CrmPriceSetKinds],
})
export class CrmPriceSetModule {}
