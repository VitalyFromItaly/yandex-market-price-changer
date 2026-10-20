import { Module } from '@nestjs/common';

import { FinanceCashflowModule } from './finance-cashflow.module';
import { FinanceForecastService } from './finance-forecast.service';
import { FinanceTaxModule } from './finance-tax.module';
import { FinanceModule } from './finance.module';

/**
 * Прогнозы (TASK-151). Отдельный модуль: им пользуются и CRM, и ИИ-инструменты,
 * а `FinanceCashflowModule` в `FinanceModule` не входит.
 */
@Module({
  imports: [FinanceModule, FinanceCashflowModule, FinanceTaxModule],
  providers: [FinanceForecastService],
  exports: [FinanceForecastService],
})
export class FinanceForecastModule {}
