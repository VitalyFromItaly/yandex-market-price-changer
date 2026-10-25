import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { AccessModule } from './modules/access/access.module';
import { AdminAuthModule } from './modules/admin/admin-auth.module';
import { AiAdminModule } from './modules/ai/ai-admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AiToolsModule } from './modules/ai-tools/ai-tools.module';
import { CrmAiAnalystModule } from './modules/crm/ai-analyst/crm-ai-analyst.module';
import { CrmCardsModule } from './modules/crm/cards/crm-cards.module';
import { CrmConnectionsModule } from './modules/crm/connections/crm-connections.module';
import { CrmModule } from './modules/crm/crm.module';
import { CrmExpensesModule } from './modules/crm/expenses/crm-expenses.module';
import { CrmFbyModule } from './modules/crm/fby/crm-fby.module';
import { CrmFeedbackModule } from './modules/crm/feedback/crm-feedback.module';
import { CrmFinanceModule } from './modules/crm/finance/crm-finance.module';
import { CrmForecastModule } from './modules/crm/forecast/crm-forecast.module';
import { CrmInventoryModule } from './modules/crm/inventory/crm-inventory.module';
import { CrmJobsModule } from './modules/crm/jobs/crm-jobs.module';
import { CrmMarketReportsModule } from './modules/crm/market-reports/crm-market-reports.module';
import { CrmMarketplaceCompareModule } from './modules/crm/marketplace-compare/crm-marketplace-compare.module';
import { CrmMarketplacesModule } from './modules/crm/marketplaces/crm-marketplaces.module';
import { CrmMarketplacesDashboardModule } from './modules/crm/marketplaces-dashboard/crm-marketplaces-dashboard.module';
import { CrmNotificationsModule } from './modules/crm/notifications/crm-notifications.module';
import { CrmOrderFeedModule } from './modules/crm/order-feed/crm-order-feed.module';
import { CrmOrdersModule } from './modules/crm/orders/crm-orders.module';
import { CrmOverviewModule } from './modules/crm/overview/crm-overview.module';
import { CrmOzonModule } from './modules/crm/ozon/crm-ozon.module';
import { CrmPaymentsModule } from './modules/crm/payments/crm-payments.module';
import { CrmPriceCalcModule } from './modules/crm/price-calculator/crm-price-calc.module';
import { CrmPriceListModule } from './modules/crm/price-list/crm-price-list.module';
import { CrmProductsModule } from './modules/crm/products/crm-products.module';
import { CrmProfileModule } from './modules/crm/profile/crm-profile.module';
import { CrmProfitModule } from './modules/crm/profit/crm-profit.module';
import { CrmPurchasesModule } from './modules/crm/purchases/crm-purchases.module';
import { CrmQuarantineModule } from './modules/crm/quarantine/crm-quarantine.module';
import { CrmRecommendationsModule } from './modules/crm/recommendations/crm-recommendations.module';
import { CrmReturnsAnalyticsModule } from './modules/crm/returns-analytics/crm-returns-analytics.module';
import { CrmSalesAnalyticsModule } from './modules/crm/sales-analytics/crm-sales-analytics.module';
import { CrmSettingsModule } from './modules/crm/settings/crm-settings.module';
import { CrmSkuRatingsModule } from './modules/crm/sku-ratings/crm-sku-ratings.module';
import { CrmStockPushModule } from './modules/crm/stock-push/crm-stock-push.module';
import { CrmStocksModule } from './modules/crm/stocks/crm-stocks.module';
import { CrmStoresModule } from './modules/crm/stores/crm-stores.module';
import { CrmTaxesModule } from './modules/crm/taxes/crm-taxes.module';
import { CrmUnitEconomicsModule } from './modules/crm/unit-economics/crm-unit-economics.module';
import { CrmWarehousesModule } from './modules/crm/warehouses/crm-warehouses.module';
import { CrmWbModule } from './modules/crm/wb/crm-wb.module';
import { ErrorsModule } from './modules/errors/errors.module';
import { FinanceAdminModule } from './modules/finance/finance-admin.module';
import { HealthModule } from './modules/health/health.module';
import { LogsModule } from './modules/logs/logs.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ProductAdminModule } from './modules/products/product-admin.module';
import { QueuesModule } from './modules/queues/queues.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { YandexModule } from './modules/yandex/yandex.module';

@Module({
  imports: [
    // Первым: валидирует окружение до того, как остальные модули начнут его
    // читать. Раньше настройки Redis вычислялись прямо в декораторе ниже, из
    // process.env, и работали лишь потому, что `import 'dotenv/config'` из
    // database.module.ts успевал исполниться раньше. Перестановка импортов
    // молча увела бы Bull на localhost.
    AppConfigModule,
    CqrsModule.forRoot(),
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        redis: {
          host: config.redisHost,
          port: config.redisPort,
          password: config.redisPassword,
        },
      }),
    }),
    DatabaseModule,
    ErrorsModule,
    // ИИ: без ключа поднимается и молчит; наружу — только AiService (TASK-104).
    AiModule,
    AdminAuthModule,
    LogsModule,
    MetricsModule,
    // Страница «ИИ» в админке: расход по AiUsage и баланс (TASK-106).
    AiAdminModule,
    // Инструменты ИИ: чтение финансов продавца для completeWithTools (TASK-147).
    AiToolsModule,
    // Корректировки финансового журнала для владельца (TASK-111).
    FinanceAdminModule,
    // Сопоставление карточек площадок с товарами: очередь и ручная привязка (TASK-117).
    ProductAdminModule,
    AccessModule,
    CrmModule,
    CrmJobsModule,
    CrmOrdersModule,
    CrmProfitModule,
    CrmPriceListModule,
    CrmSettingsModule,
    CrmExpensesModule,
    CrmTaxesModule,
    CrmPurchasesModule,
    CrmProductsModule,
    CrmFinanceModule,
    CrmMarketplacesModule,
    CrmConnectionsModule,
    CrmOzonModule,
    CrmWbModule,
    CrmStoresModule,
    CrmProfileModule,
    CrmQuarantineModule,
    CrmFeedbackModule,
    CrmPaymentsModule,
    CrmMarketReportsModule,
    CrmRecommendationsModule,
    CrmCardsModule,
    CrmFbyModule,
    CrmWarehousesModule,
    CrmStocksModule,
    CrmOverviewModule,
    CrmUnitEconomicsModule,
    CrmSalesAnalyticsModule,
    CrmReturnsAnalyticsModule,
    CrmNotificationsModule,
    CrmMarketplaceCompareModule,
    CrmMarketplacesDashboardModule,
    CrmInventoryModule,
    CrmOrderFeedModule,
    CrmStockPushModule,
    CrmSkuRatingsModule,
    CrmForecastModule,
    CrmPriceCalcModule,
    CrmAiAnalystModule,
    QueuesModule,
    YandexModule,
    TelegramModule,
    // После TelegramModule: монитор тянет из него очередь reports ради клиента
    // Redis, а алерты уходят через ErrorAlertBridge, которому нужны боты.
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
