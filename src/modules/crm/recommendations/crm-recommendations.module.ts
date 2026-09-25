import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmRecommendationsKinds } from './crm-recommendations.kinds';

/**
 * «Рекомендации цен» в CRM. Контроллера нет: параметров у среза нет, опции
 * форме не нужны — отчёт идёт фоновой задачей через /api/crm/ym/jobs.
 */
@Module({
  imports: [CrmJobsModule, YandexModule],
  providers: [CrmRecommendationsKinds],
})
export class CrmRecommendationsModule {}
