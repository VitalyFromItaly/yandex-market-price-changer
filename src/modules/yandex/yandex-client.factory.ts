import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';

import {
  IYandexTenantCredentials,
  YandexApiClient,
  type IYandexClientOptions,
} from './yandex-api.client';

/**
 * Фабрика клиентов Partner API.
 *
 * Провайдер синглтон, а КЛИЕНТ — нет: у каждого продавца свой токен и свои
 * идентификаторы. Раньше клиент создавался прямо в обработчике очереди через
 * `new PriceChanger(token, campaign_id, business_id)`, минуя DI, — базовый URL
 * при этом брался из другого места, и подменить его в тестах было нечем.
 *
 * Клиенты НЕ кэшируются. Кэш пришлось бы ключевать по кредам, а ошибка в ключе
 * здесь означает не промах кэша, а запрос к чужому магазину с чужим токеном.
 * Создание экземпляра — это axios.create, оно копеечное; отчёт строится раз в
 * сутки на продавца, экономить тут нечего.
 */
@Injectable()
export class YandexClientFactory {
  private readonly logger = new Logger(YandexClientFactory.name);

  constructor(private readonly config: AppConfigService) {}

  public forTenant(
    credentials: IYandexTenantCredentials,
    options?: IYandexClientOptions,
  ): YandexApiClient {
    this.assertComplete(credentials);
    return new YandexApiClient(credentials, this.config.yandexMarketBaseUrl, options);
  }

  /**
   * Клиент, у которого есть ТОЛЬКО токен.
   *
   * Нужен ровно для одного случая — узнать идентификаторы магазинов до того,
   * как они известны. Обычный forTenant здесь не подходит: он требует полный
   * набор кредов, и это правильно — запрос за данными магазина без указания
   * магазина был бы ошибкой. Здесь же оба поля заведомо пусты, и единственный
   * доступный метод — listStores().
   */
  public forTokenOnly(token: string, options?: IYandexClientOptions): YandexApiClient {
    if (!token?.trim()) {
      throw new Error('Нужен токен');
    }
    return new YandexApiClient(
      { token, campaignId: '', businessId: '' },
      this.config.yandexMarketBaseUrl,
      options,
    );
  }

  /**
   * Клиент из документа настроек продавца. Отдельный метод, чтобы поля
   * `campaign_id`/`business_id` перекладывались в camelCase ровно один раз, а
   * не в каждом вызывающем месте.
   */
  public forStore(store: YandexMarketDocument, options?: IYandexClientOptions): YandexApiClient {
    return this.forTenant(
      {
        token: store?.token,
        campaignId: store?.campaign_id,
        businessId: store?.business_id,
      },
      options,
    );
  }

  /**
   * Падаем сразу и внятно. Без этой проверки пустой токен уходит в заголовок,
   * Яндекс отвечает 401, и в логах остаётся «неверный токен» вместо «токена
   * нет вообще» — разные проблемы с одинаковым симптомом.
   */
  private assertComplete(credentials: IYandexTenantCredentials): void {
    const missing = (['token', 'campaignId', 'businessId'] as const).filter(
      (field) => !credentials?.[field],
    );
    if (missing.length) {
      throw new Error(`Нельзя создать клиент Яндекс.Маркета: не заполнено ${missing.join(', ')}`);
    }
  }
}
