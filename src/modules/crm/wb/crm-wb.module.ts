import { Module } from '@nestjs/common';

import { WbModule } from '../../wb/wb.module';
import { CrmModule } from '../crm.module';

import { CrmWbController } from './crm-wb.controller';

/** Wildberries в CRM. Гвард — из CrmModule, проверка и запись токена — из WbModule. */
@Module({
  imports: [CrmModule, WbModule],
  controllers: [CrmWbController],
})
export class CrmWbModule {}
