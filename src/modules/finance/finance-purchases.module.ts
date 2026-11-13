import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';

import { FinancePurchasesService } from './finance-purchases.service';

/**
 * Закупки партий и уплаченные налоги (TASK-122). Клиент Маркета не нужен — по
 * доводу FinanceExpensesModule. Mongo (DatabaseModule) — с TASK-214: партии
 * «Финучёта» сопоставляют артикулы позиций с товарами (`ProductService`).
 */
@Module({
  imports: [DatabaseModule, PostgresModule],
  providers: [FinancePurchasesService],
  exports: [FinancePurchasesService],
})
export class FinancePurchasesModule {}
