import { Module } from '@nestjs/common';

import { FinanceCashflowModule } from '../../finance/finance-cashflow.module';
import { FinanceExpensesModule } from '../../finance/finance-expenses.module';
import { FinanceScreenModule } from '../../finance/finance-screen.module';
import { FinanceModule } from '../../finance/finance.module';
import { CrmModule } from '../crm.module';
import { CrmJobsModule } from '../jobs/crm-jobs.module';

import { CrmFinanceController } from './crm-finance.controller';
import { CrmFinanceKinds } from './crm-finance.kinds';

/**
 * «Финансы» CRM (TASK-124). P&L — kind фоновых задач поверх FinanceModule
 * (Маркет и Mongo ради плоской оценки), остальное — Postgres-модули.
 */
@Module({
  imports: [
    CrmModule,
    CrmJobsModule,
    FinanceModule,
    FinanceScreenModule,
    FinanceCashflowModule,
    FinanceExpensesModule,
  ],
  controllers: [CrmFinanceController],
  providers: [CrmFinanceKinds],
})
export class CrmFinanceModule {}
