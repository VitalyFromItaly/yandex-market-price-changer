import { Module } from '@nestjs/common';

import { FinanceModule } from '../../finance/finance.module';
import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmProfitKinds } from './crm-profit.kinds';

/**
 * «Прибыль» и «Калькулятор» в CRM. Своего контроллера нет: отчёты идут
 * фоновыми задачами через /api/crm/ym/jobs, модуль только регистрирует kind-ы.
 * Очередь не регистрируется — она живёт в TelegramModule (правило QueuesModule).
 */
@Module({
  imports: [CrmJobsModule, YandexModule, FinanceModule],
  providers: [CrmProfitKinds],
})
export class CrmProfitModule {}
