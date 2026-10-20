import { Module } from '@nestjs/common';

import { FinancePurchasesModule } from '../../finance/finance-purchases.module';
import { CrmModule } from '../crm.module';

import { CrmPurchasesController } from './crm-purchases.controller';

/**
 * «Закупки» CRM. Закупки — из финмодуля на Postgres, без Маркета и Mongo;
 * гвард — из CrmModule. ДДС — в CrmFinanceModule.
 */
@Module({
  imports: [CrmModule, FinancePurchasesModule],
  controllers: [CrmPurchasesController],
})
export class CrmPurchasesModule {}
