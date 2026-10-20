import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../../database/database.module';
import { FinancePriceCalcModule } from '../../finance/finance-price-calc.module';
import { YandexModule } from '../../yandex/yandex.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmPriceCalcKinds } from './crm-price-calc.kinds';

/** «Калькулятор цен» CRM (TASK-139). Контроллера нет: два kind-а фоновых задач. */
@Module({
  imports: [CrmJobsModule, DatabaseModule, FinancePriceCalcModule, YandexModule],
  providers: [CrmPriceCalcKinds],
})
export class CrmPriceCalcModule {}
