import { Module } from '@nestjs/common';

import { PostgresModule } from '../../database/postgres/postgres.module';

import { FinanceScreenService } from './finance-screen.service';

/**
 * Данные экрана «Финансы» (TASK-124) — только Postgres, довод
 * `FinanceExpensesModule`: P&L с его Маркетом и Mongo — в FinanceModule.
 */
@Module({
  imports: [PostgresModule],
  providers: [FinanceScreenService],
  exports: [FinanceScreenService],
})
export class FinanceScreenModule {}
