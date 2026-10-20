import { Module } from '@nestjs/common';

import { FinanceTaxModule } from '../../finance/finance-tax.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmTaxesController } from './crm-taxes.controller';
import { CrmTaxesKinds } from './crm-taxes.kinds';

/**
 * «Налоги» CRM. Сервис — из FinanceTaxModule, где его же возьмёт движок P&L:
 * одна дверь к налоговым настройкам на оба потребителя. Гвард — из CrmModule.
 * Kind года (TASK-146) зовёт FinanceModule — расчёт идёт через движок P&L.
 */
@Module({
  imports: [CrmModule, CrmJobsModule, FinanceTaxModule, FinanceModule],
  controllers: [CrmTaxesController],
  providers: [CrmTaxesKinds],
})
export class CrmTaxesModule {}
