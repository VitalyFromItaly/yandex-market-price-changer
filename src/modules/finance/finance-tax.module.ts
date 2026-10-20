import { Module } from '@nestjs/common';

import { PostgresModule } from '../../database/postgres/postgres.module';

import { FinanceTaxYearDataService } from './finance-tax-year-data.service';
import { FinanceTaxService } from './finance-tax.service';

/**
 * Налоговые настройки (TASK-123) и ручные данные налогового модуля ИП
 * (TASK-146: параметры лет, уменьшения, сверки). Отдельно от FinanceModule по доводу
 * FinanceExpensesModule: нужен только Postgres, клиент Маркета и Mongo — нет.
 */
@Module({
  imports: [PostgresModule],
  providers: [FinanceTaxService, FinanceTaxYearDataService],
  exports: [FinanceTaxService, FinanceTaxYearDataService],
})
export class FinanceTaxModule {}
