import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';

import { OrderReportsService } from './reports/order-reports.service';
import { ProfitService } from './reports/profit.service';
import { StockSyncService } from './stocks/stock-sync.service';
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
  providers: [YandexClientFactory, OrderReportsService, ProfitService, StockSyncService],
  exports: [YandexClientFactory, OrderReportsService, ProfitService, StockSyncService],
})
export class YandexModule {}
