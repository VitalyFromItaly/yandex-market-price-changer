import { Module } from '@nestjs/common';

import { OzonModule } from '../../ozon/ozon.module';
import { CrmModule } from '../crm.module';

import { CrmOzonController } from './crm-ozon.controller';

/** Ozon в CRM. Гвард — из CrmModule, проверка и запись ключа — из OzonModule. */
@Module({
  imports: [CrmModule, OzonModule],
  controllers: [CrmOzonController],
})
export class CrmOzonModule {}
