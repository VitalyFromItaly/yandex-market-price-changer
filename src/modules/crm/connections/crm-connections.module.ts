import { Module } from '@nestjs/common';

import { MarketplacesModule } from '../../marketplaces/marketplaces.module';
import { CrmModule } from '../crm.module';

import { CrmConnectionsController } from './crm-connections.controller';

/** «Подключения» в CRM. Гвард — из CrmModule, карточки и проверка — из MarketplacesModule. */
@Module({
  imports: [CrmModule, MarketplacesModule],
  controllers: [CrmConnectionsController],
})
export class CrmConnectionsModule {}
