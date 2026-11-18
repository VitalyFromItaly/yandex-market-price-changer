import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmTopSkusKinds } from './crm-top-skus.kinds';

/**
 * «Топ товаров» в CRM. Контроллера нет: отчёт идёт фоновой задачей через
 * /api/crm/ym/jobs, модуль только регистрирует kind.
 */
@Module({
  imports: [CrmJobsModule, YandexModule],
  providers: [CrmTopSkusKinds],
})
export class CrmTopSkusModule {}
