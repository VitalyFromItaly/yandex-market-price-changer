import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';

import { CrmJobsController } from './crm-jobs.controller';
import { CrmJobsProcessor } from './crm-jobs.processor';
import { CrmJobsRegistry } from './crm-jobs.registry';

/**
 * Фоновые задачи CRM (/api/crm/ym/jobs, очередь `crm-jobs`).
 *
 * Отдельно от CrmModule: очередь регистрируется только в TelegramModule
 * (своя регистрация = второе соединение с Redis и второе место с опциями), а
 * тянуть граф бота во вход и гейт CRM незачем. forwardRef — прецедент
 * QueuesModule/HealthModule. Журнал запросов подключается сам: middleware
 * CrmModule висит на пути `crm/{*path}`.
 *
 * Модули фич регистрируют свои kind-ы в `CrmJobsRegistry` — он экспортируется.
 */
@Module({
  imports: [DatabaseModule, CrmModule, YandexModule, forwardRef(() => TelegramModule)],
  controllers: [CrmJobsController],
  providers: [CrmJobsRegistry, CrmJobsProcessor],
  exports: [CrmJobsRegistry],
})
export class CrmJobsModule {}
