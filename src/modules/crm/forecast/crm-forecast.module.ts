import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinanceForecastModule } from '../../finance/finance-forecast.module';
import { FinanceModule } from '../../finance/finance.module';
import { MarketplacesModule } from '../../marketplaces/marketplaces.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmForecastKinds } from './crm-forecast.kinds';

/** «Прогнозы» CRM (TASK-151). Контроллера нет: два kind-а фоновых задач. */
@Module({
  imports: [
    CrmJobsModule,
    DatabaseModule,
    FinanceModule,
    FinanceForecastModule,
    MarketplacesModule,
  ],
  providers: [CrmForecastKinds],
})
export class CrmForecastModule {}
