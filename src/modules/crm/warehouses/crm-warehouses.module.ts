import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmWarehousesKinds } from './crm-warehouses.kinds';

/** «Склады» в CRM. Контроллера нет — срез без параметров идёт через /api/crm/ym/jobs. */
@Module({
  imports: [CrmJobsModule, YandexModule],
  providers: [CrmWarehousesKinds],
})
export class CrmWarehousesModule {}
