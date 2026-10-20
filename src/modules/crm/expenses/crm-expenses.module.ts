import { Module } from '@nestjs/common';

import { FinanceExpensesModule } from '../../finance/finance-expenses.module';
import { CrmModule } from '../crm.module';

import { CrmExpensesController } from './crm-expenses.controller';

/**
 * «Расходы» CRM. Сервис — из FinanceExpensesModule, где его же возьмёт движок
 * P&L: одна дверь к расходам на оба потребителя. Гвард — из CrmModule.
 */
@Module({
  imports: [CrmModule, FinanceExpensesModule],
  controllers: [CrmExpensesController],
})
export class CrmExpensesModule {}
