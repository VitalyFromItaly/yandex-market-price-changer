import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';
import { FinanceCashflowModule } from '../finance/finance-cashflow.module';
import { FinanceExpensesModule } from '../finance/finance-expenses.module';
import { FinancePriceCalcModule } from '../finance/finance-price-calc.module';
import { FinanceTaxModule } from '../finance/finance-tax.module';
import { MarketplacesModule } from '../marketplaces/marketplaces.module';
import { YandexModule } from '../yandex/yandex.module';

import { AccountingAllocationSettingsService } from './accounting-allocation-settings.service';
import { AccountingAnalyticsService } from './accounting-analytics.service';
import { AccountingCogsService } from './accounting-cogs.service';
import { AccountingCostHistoryModule } from './accounting-cost-history.module';
import { AccountingCostSettingsService } from './accounting-cost-settings.service';
import { AccountingDashboardService } from './accounting-dashboard.service';
import { AccountingLotCostService } from './accounting-lot-cost.service';
import { AccountingManualOperationsService } from './accounting-manual-operations.service';
import { AccountingOrderCardService } from './accounting-order-card.service';
import { AccountingOrdersService } from './accounting-orders.service';
import { AccountingReconcileService } from './accounting-reconcile.service';
import { AccountingReturnsService } from './accounting-returns.service';
import { AccountingStoreCostsService } from './accounting-store-costs.service';
import { AccountingTaxSettingsService } from './accounting-tax-settings.service';
import { AccountingTaxService } from './accounting-tax.service';
import { AccountingService } from './accounting.service';

/**
 * «Финучёт» (TASK-206). Отдельный доменный модуль, как `PriceSetModule`: его будут
 * звать и CRM, и фоновые задачи M29–M33 (снимок строк заказов, импорт), поэтому
 * он не тянет ни граф бота, ни CRM.
 */
@Module({
  imports: [
    DatabaseModule,
    PostgresModule,
    YandexModule,
    MarketplacesModule,
    AccountingCostHistoryModule,
    FinanceTaxModule,
    FinanceExpensesModule,
    FinancePriceCalcModule,
    FinanceCashflowModule,
  ],
  providers: [
    AccountingService,
    AccountingManualOperationsService,
    AccountingReconcileService,
    AccountingOrdersService,
    AccountingAllocationSettingsService,
    AccountingStoreCostsService,
    AccountingCogsService,
    AccountingCostSettingsService,
    AccountingLotCostService,
    AccountingTaxSettingsService,
    AccountingTaxService,
    AccountingOrderCardService,
    AccountingDashboardService,
    AccountingReturnsService,
    AccountingAnalyticsService,
  ],
  exports: [
    AccountingCostHistoryModule,
    AccountingService,
    AccountingManualOperationsService,
    AccountingReconcileService,
    AccountingOrdersService,
    AccountingAllocationSettingsService,
    AccountingCogsService,
    AccountingCostSettingsService,
    AccountingLotCostService,
    AccountingTaxSettingsService,
    AccountingTaxService,
    AccountingOrderCardService,
    AccountingDashboardService,
    AccountingReturnsService,
    AccountingAnalyticsService,
  ],
})
export class AccountingModule {}
