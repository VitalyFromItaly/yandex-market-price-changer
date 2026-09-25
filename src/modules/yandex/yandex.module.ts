import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { CardsService } from './cards/cards.service';
import { FbyStockService } from './fby/fby-stock.service';
import { FbyService } from './fby/fby.service';
import { FeedbackService } from './feedback/feedback.service';
import { MarketCategoriesService } from './market-reports/market-categories.service';
import { MarketReportsService } from './market-reports/market-reports.service';
import { PaymentsReportService } from './payments/payments-report.service';
import { QuarantineService } from './quarantine/quarantine.service';
import { RecommendationsService } from './recommendations/recommendations.service';
import { OrderReportsService } from './reports/order-reports.service';
import { ProfitService } from './reports/profit.service';
import { StoreSettingsService } from './settings/store-settings.service';
import { StockSyncService } from './stocks/stock-sync.service';
import { StockUploadPolicyService } from './stocks/stock-upload-policy.service';
import { StoresService } from './stores/stores.service';
import { WarehousesService } from './warehouses/warehouses.service';
import { YandexClientFactory } from './yandex-client.factory';

/**
 * Доступ к Partner API Яндекс.Маркета.
 *
 * До этого у src/modules/yandex/** не было модуля вообще: классы создавались
 * вручную через `new` из обработчиков очередей, мимо DI, — поэтому ни базовый
 * URL, ни таймауты нельзя было подменить в тестах.
 *
 * Наружу торчит только фабрика: клиент привязан к кредам продавца и не может
 * быть провайдером (см. YandexApiClient).
 *
 * AppConfigService приходит из глобального AppConfigModule, импорты не нужны.
 *
 * DatabaseModule нужен двум вещам: закупочные цены пишутся при загрузке прайса
 * и читаются при расчёте прибыли. Цикла нет — база о Яндексе не знает.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    YandexClientFactory,
    OrderReportsService,
    ProfitService,
    StockSyncService,
    StockUploadPolicyService,
    WarehousesService,
    FbyStockService,
    FbyService,
    PaymentsReportService,
    MarketReportsService,
    MarketCategoriesService,
    StoreSettingsService,
    StoresService,
    QuarantineService,
    FeedbackService,
    RecommendationsService,
    CardsService,
  ],
  exports: [
    YandexClientFactory,
    OrderReportsService,
    ProfitService,
    StockSyncService,
    StockUploadPolicyService,
    WarehousesService,
    FbyStockService,
    FbyService,
    PaymentsReportService,
    MarketReportsService,
    MarketCategoriesService,
    StoreSettingsService,
    StoresService,
    QuarantineService,
    FeedbackService,
    RecommendationsService,
    CardsService,
  ],
})
export class YandexModule {}
