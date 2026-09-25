import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmFbyKinds } from './crm-fby.kinds';

/** «FBY» в CRM. Контроллера нет — срез без параметров идёт через /api/crm/ym/jobs. */
@Module({
  imports: [CrmJobsModule, YandexModule],
  providers: [CrmFbyKinds],
})
export class CrmFbyModule {}
