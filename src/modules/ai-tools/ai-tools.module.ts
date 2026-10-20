import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { FinanceCashflowModule } from '../finance/finance-cashflow.module';
import { FinanceExpensesModule } from '../finance/finance-expenses.module';
import { FinanceForecastModule } from '../finance/finance-forecast.module';
import { FinancePriceCalcModule } from '../finance/finance-price-calc.module';
import { FinanceScreenModule } from '../finance/finance-screen.module';
import { FinanceModule } from '../finance/finance.module';
import { YandexModule } from '../yandex/yandex.module';

import { AiToolsService } from './ai-tools.service';

/**
 * Инструменты ИИ (TASK-147). Отдельно от AiModule: тот импортируют монитор и
 * админка, и тянуть им финансы с Маркетом незачем. Цикл вызовов — в
 * AiService.completeWithTools, данные — здесь; обратно сюда никто из финансов
 * не смотрит, поэтому цикла модулей нет.
 */
@Module({
  imports: [
    DatabaseModule,
    FinanceModule,
    FinanceScreenModule,
    FinanceForecastModule,
    FinanceCashflowModule,
    FinanceExpensesModule,
    FinancePriceCalcModule,
    YandexModule,
  ],
  providers: [AiToolsService],
  exports: [AiToolsService],
})
export class AiToolsModule {}
