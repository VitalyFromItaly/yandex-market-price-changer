import { Module } from '@nestjs/common';

import { FinanceModule } from '../../finance/finance.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmMarketplaceCompareKinds } from './crm-marketplace-compare.kinds';

/** «Сравнение площадок» CRM (TASK-137). Контроллера нет: один kind фоновых задач. */
@Module({
  imports: [CrmJobsModule, FinanceModule],
  providers: [CrmMarketplaceCompareKinds],
})
export class CrmMarketplaceCompareModule {}
