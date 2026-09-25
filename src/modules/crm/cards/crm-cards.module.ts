import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmCardsKinds } from './crm-cards.kinds';

/** «Карточки» в CRM. Контроллера нет — срез без параметров идёт через /api/crm/ym/jobs. */
@Module({
  imports: [CrmJobsModule, YandexModule],
  providers: [CrmCardsKinds],
})
export class CrmCardsModule {}
