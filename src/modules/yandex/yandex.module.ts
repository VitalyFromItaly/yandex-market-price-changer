import { Module } from '@nestjs/common';

import { OrderReportsService } from './reports/order-reports.service';
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
 */
@Module({
  providers: [YandexClientFactory, OrderReportsService],
  exports: [YandexClientFactory, OrderReportsService],
})
export class YandexModule {}
