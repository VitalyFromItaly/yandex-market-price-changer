import { Module } from '@nestjs/common';

import { YandexModule } from '../../yandex/yandex.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmPaymentsController } from './crm-payments.controller';
import { CrmPaymentsKinds } from './crm-payments.kinds';

/**
 * «Платежи» в CRM: kind `payments:report` и опции формы. Сервис —
 * `PaymentsReportService` из YandexModule, общий с ботом; гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, CrmJobsModule, YandexModule],
  controllers: [CrmPaymentsController],
  providers: [CrmPaymentsKinds],
})
export class CrmPaymentsModule {}
