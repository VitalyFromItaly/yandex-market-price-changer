import { Module } from '@nestjs/common';

import { MarketplacesModule } from '../../marketplaces/marketplaces.module';
import { CrmModule } from '../crm.module';

import { CrmMarketplacesController } from './crm-marketplaces.controller';

/** Площадки продавца в CRM. Гвард — из CrmModule, сводка — из MarketplacesModule. */
@Module({
  imports: [CrmModule, MarketplacesModule],
  controllers: [CrmMarketplacesController],
})
export class CrmMarketplacesModule {}
