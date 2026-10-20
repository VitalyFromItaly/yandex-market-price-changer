import { Module } from '@nestjs/common';

import { PostgresModule } from '../../database/postgres/postgres.module';

import { FinanceExpensesService } from './finance-expenses.service';

/**
 * Операционные расходы (TASK-121). Отдельно от FinanceModule: тот тянет
 * Yandex и Mongo ради импорта журнала, а расходам нужен только Postgres —
 * CRM-разделу и будущему P&L незачем поднимать клиент Маркета.
 */
@Module({
  imports: [PostgresModule],
  providers: [FinanceExpensesService],
  exports: [FinanceExpensesService],
})
export class FinanceExpensesModule {}
