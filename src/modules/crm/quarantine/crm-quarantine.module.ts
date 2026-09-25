import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmQuarantineController } from './crm-quarantine.controller';

/**
 * «Карантин цен» CRM. Сервис — `QuarantineService` из YandexModule, общий с
 * ботом; магазин по ключу — `StoresService`; гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, YandexModule],
  controllers: [CrmQuarantineController],
})
export class CrmQuarantineModule {}
