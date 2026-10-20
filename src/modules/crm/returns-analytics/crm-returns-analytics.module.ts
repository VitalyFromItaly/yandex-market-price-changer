import { Module } from '@nestjs/common';

import { FinanceModule } from '../../finance/finance.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmReturnsAnalyticsKinds } from './crm-returns-analytics.kinds';

/** «Аналитика возвратов» CRM (TASK-145). Контроллера нет: один kind фоновых задач. */
@Module({
  imports: [CrmJobsModule, FinanceModule],
  providers: [CrmReturnsAnalyticsKinds],
})
export class CrmReturnsAnalyticsModule {}
