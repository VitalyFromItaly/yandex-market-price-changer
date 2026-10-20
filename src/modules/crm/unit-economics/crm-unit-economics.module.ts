import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmUnitEconomicsKinds } from './crm-unit-economics.kinds';

/** «Unit-экономика» CRM (TASK-138). Контроллера нет: один kind фоновых задач. */
@Module({
  imports: [CrmJobsModule, DatabaseModule, FinanceModule],
  providers: [CrmUnitEconomicsKinds],
})
export class CrmUnitEconomicsModule {}
