import { Module } from '@nestjs/common';

import { PostgresModule } from '../../database/postgres/postgres.module';

import { FinanceCashflowService } from './finance-cashflow.service';
import { FinanceExpensesModule } from './finance-expenses.module';
import { FinancePurchasesModule } from './finance-purchases.module';

/**
 * ДДС, выплаты и «к получению» (TASK-122). Только Postgres: журнал, расходы и
 * закупки там, а Маркет и Mongo здесь не нужны — тяжёлый FinanceModule не
 * импортируется.
 */
@Module({
  imports: [PostgresModule, FinanceExpensesModule, FinancePurchasesModule],
  providers: [FinanceCashflowService],
  exports: [FinanceCashflowService],
})
export class FinanceCashflowModule {}
