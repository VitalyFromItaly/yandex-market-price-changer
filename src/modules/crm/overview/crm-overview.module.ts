import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinanceCashflowModule } from '../../finance/finance-cashflow.module';
import { FinanceModule } from '../../finance/finance.module';
import { MarketplacesModule } from '../../marketplaces/marketplaces.module';
import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmOverviewKinds } from './crm-overview.kinds';

/**
 * «Обзор» CRM (TASK-125). Контроллера нет: три kind-а фоновых задач, площадки —
 * из существующего `GET /api/crm/marketplaces`.
 */
@Module({
  imports: [
    CrmJobsModule,
    DatabaseModule,
    FinanceModule,
    FinanceCashflowModule,
    MarketplacesModule,
    YandexModule,
  ],
  providers: [CrmOverviewKinds],
})
export class CrmOverviewModule {}
