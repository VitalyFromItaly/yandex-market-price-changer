import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmSkuRatingsKinds } from './crm-sku-ratings.kinds';

/** «Рейтинги и классификации» CRM (TASK-141). Контроллера нет: один kind фоновых задач. */
@Module({
  imports: [CrmJobsModule, DatabaseModule, FinanceModule],
  providers: [CrmSkuRatingsKinds],
})
export class CrmSkuRatingsModule {}
