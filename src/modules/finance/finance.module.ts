import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PostgresModule } from '../../database/postgres/postgres.module';
import { YandexModule } from '../yandex/yandex.module';

import { FinanceAnomalyService } from './finance-anomaly.service';
import { FinanceExpensesModule } from './finance-expenses.module';
import { FinanceImportService } from './finance-import.service';
import { FinanceReconcileService } from './finance-reconcile.service';
import { FinanceTaxYearService } from './finance-tax-year.service';
import { FinanceTaxModule } from './finance-tax.module';
import { FinanceService } from './finance.service';
import { OrderFeedService } from './order-feed.service';
import { ReturnsAnalyticsService } from './returns-analytics.service';

/**
 * Финансовый журнал: импорт отчётов площадок, сверка с заказами, движок P&L
 * (`FinanceService`, TASK-120) и детектор аномалий (TASK-149). Процессор очереди
 * `finance-import` живёт в TelegramModule — очереди регистрируются только там.
 */
@Module({
  imports: [DatabaseModule, PostgresModule, YandexModule, FinanceTaxModule, FinanceExpensesModule],
  providers: [
    FinanceImportService,
    FinanceReconcileService,
    FinanceService,
    FinanceAnomalyService,
    FinanceTaxYearService,
    OrderFeedService,
    ReturnsAnalyticsService,
  ],
  exports: [
    FinanceImportService,
    FinanceService,
    FinanceAnomalyService,
    FinanceTaxYearService,
    OrderFeedService,
    ReturnsAnalyticsService,
  ],
})
export class FinanceModule {}
