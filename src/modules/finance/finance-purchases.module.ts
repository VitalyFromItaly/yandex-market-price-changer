import { Module } from '@nestjs/common';

import { PostgresModule } from '../../database/postgres/postgres.module';

import { FinancePurchasesService } from './finance-purchases.service';

/**
 * Закупки партий и уплаченные налоги (TASK-122). Только Postgres — по доводу
 * FinanceExpensesModule: CRM-разделу незачем поднимать клиент Маркета и Mongo.
 */
@Module({
  imports: [PostgresModule],
  providers: [FinancePurchasesService],
  exports: [FinancePurchasesService],
})
export class FinancePurchasesModule {}
