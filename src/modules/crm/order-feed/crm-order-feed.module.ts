import { Module } from '@nestjs/common';

import { FinanceModule } from '../../finance/finance.module';
import { MarketplacesModule } from '../../marketplaces/marketplaces.module';
import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmOrderFeedController } from './crm-order-feed.controller';
import { CrmOrderFeedKinds } from './crm-order-feed.kinds';

/** «Лента заказов» CRM (TASK-144): kind списка и GET истории операций заказа. */
@Module({
  imports: [CrmJobsModule, CrmModule, FinanceModule, MarketplacesModule, YandexModule],
  controllers: [CrmOrderFeedController],
  providers: [CrmOrderFeedKinds],
})
export class CrmOrderFeedModule {}
