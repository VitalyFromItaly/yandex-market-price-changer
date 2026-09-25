import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { CrmModule } from '../crm.module';

import { CrmProfileController } from './crm-profile.controller';

/** «Профиль» и «Помощь» CRM. Гвард — из CrmModule, данные — из DatabaseModule. */
@Module({
  imports: [DatabaseModule, CrmModule],
  controllers: [CrmProfileController],
})
export class CrmProfileModule {}
