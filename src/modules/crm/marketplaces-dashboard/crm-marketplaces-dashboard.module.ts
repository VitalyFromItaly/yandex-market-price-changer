import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmMarketplacesDashboardKinds } from './crm-marketplaces-dashboard.kinds';

/** Дашборд «Площадки» CRM (TASK-191). Контроллера нет: один kind фоновых задач. */
@Module({
  imports: [CrmJobsModule, FinanceModule, DatabaseModule],
  providers: [CrmMarketplacesDashboardKinds],
})
export class CrmMarketplacesDashboardModule {}
