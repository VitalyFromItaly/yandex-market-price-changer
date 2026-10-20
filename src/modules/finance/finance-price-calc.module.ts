import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { FinanceTaxModule } from './finance-tax.module';
import { FinanceModule } from './finance.module';
import { PriceCalcRatesService } from './price-calc-rates.service';

/**
 * Ставки «Калькулятора цен» (TASK-165): одна сборка на CRM-kind и ИИ.
 * Отдельно от FinanceModule — тот не знает про калькулятор, а CRM-модулю
 * калькулятора и ИИ незачем друг про друга.
 */
@Module({
  imports: [DatabaseModule, FinanceModule, FinanceTaxModule],
  providers: [PriceCalcRatesService],
  exports: [PriceCalcRatesService],
})
export class FinancePriceCalcModule {}
