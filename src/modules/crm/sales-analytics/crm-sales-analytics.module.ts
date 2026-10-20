import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmSalesAnalyticsKinds } from './crm-sales-analytics.kinds';

/** «Аналитика продаж» CRM (TASK-140). Контроллера нет: один kind фоновых задач. */
@Module({
  imports: [CrmJobsModule, DatabaseModule, FinanceModule],
  providers: [CrmSalesAnalyticsKinds],
})
export class CrmSalesAnalyticsModule {}
