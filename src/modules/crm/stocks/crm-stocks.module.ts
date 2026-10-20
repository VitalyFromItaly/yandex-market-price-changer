import { Module } from '@nestjs/common';

import { MarketplacesModule } from '../../marketplaces/marketplaces.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmStocksKinds } from './crm-stocks.kinds';

/** Остатки по товарам для главной CRM. Контроллера нет — срез идёт через /api/crm/ym/jobs. */
@Module({
  imports: [CrmJobsModule, MarketplacesModule],
  providers: [CrmStocksKinds],
})
export class CrmStocksModule {}
