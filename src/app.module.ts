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
import { CrmCardsModule } from './modules/crm/cards/crm-cards.module';
import { CrmModule } from './modules/crm/crm.module';
import { CrmFbyModule } from './modules/crm/fby/crm-fby.module';
import { CrmFeedbackModule } from './modules/crm/feedback/crm-feedback.module';
import { CrmJobsModule } from './modules/crm/jobs/crm-jobs.module';
import { CrmMarketReportsModule } from './modules/crm/market-reports/crm-market-reports.module';
import { CrmOrdersModule } from './modules/crm/orders/crm-orders.module';
import { CrmPaymentsModule } from './modules/crm/payments/crm-payments.module';
import { CrmPriceListModule } from './modules/crm/price-list/crm-price-list.module';
import { CrmProfileModule } from './modules/crm/profile/crm-profile.module';
import { CrmProfitModule } from './modules/crm/profit/crm-profit.module';
import { CrmQuarantineModule } from './modules/crm/quarantine/crm-quarantine.module';
import { CrmRecommendationsModule } from './modules/crm/recommendations/crm-recommendations.module';
import { CrmSettingsModule } from './modules/crm/settings/crm-settings.module';
import { CrmStoresModule } from './modules/crm/stores/crm-stores.module';
import { CrmWarehousesModule } from './modules/crm/warehouses/crm-warehouses.module';
import { ErrorsModule } from './modules/errors/errors.module';
import { HealthModule } from './modules/health/health.module';
import { LogsModule } from './modules/logs/logs.module';
import { MetricsModule } from './modules/metrics/metrics.module';
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
    AdminAuthModule,
    LogsModule,
    MetricsModule,
    AccessModule,
    CrmModule,
    CrmJobsModule,
    CrmOrdersModule,
    CrmProfitModule,
    CrmPriceListModule,
    CrmSettingsModule,
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
