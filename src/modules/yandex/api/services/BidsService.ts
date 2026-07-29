/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_requestBody_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_requestBody_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class BidsService {
  /**
   * Включение буста продаж и установка ставок
   * {% include notitle [access](../../_auto/method_scopes/putBidsForBusiness.md) %}
   *
   * Запускает буст продаж — создает и включает кампанию, добавляет в нее товары и назначает на них ставки.
   *
   * {% cut "Как в кабинете выглядит кампания, созданная через API" %}
   *
   * ![](../../_images/api-boost.png)
   *
   * {% endcut %}
   *
   * При первом использовании запроса Маркет: создаст единую на все магазины бизнес-аккаунта кампанию, добавит в нее товары с указанными ставками, включит для них ценовую стратегию и запустит продвижение. Повторное использование запроса позволит обновить ставки на товары в этой кампании или добавить новые. Подробнее о ценовой стратегии читайте в [Справке Маркета для продавцов](https://yandex.ru/support/marketplace/marketing/campaigns.html#price-strategy).
   *
   * Если товара с указанным SKU нет, он будет проигнорирован. Если в будущем в каталоге появится товар с таким SKU, он автоматически будет добавлен в кампанию с указанной ставкой.
   *
   * Запрос всегда работает с одной и той же созданной через API кампанией. Если в кабинете удалить ее, при следующем выполнении запроса Маркет создаст новую. Другими кампаниями управлять через API не получится. У созданной через API кампании всегда наибольший приоритет над остальными — изменить его нельзя.
   *
   * Выполнение запроса включает кампанию и ценовую стратегию, если они были отключены.
   *
   * Внести другие изменения в созданную через API кампанию можно в кабинете:
   *
   * * выключить или включить кампанию;
   * * изменить ее название;
   * * выключить или включить ценовую стратегию.
   *
   * Чтобы остановить продвижение отдельных товаров и удалить их из кампании, передайте для них нулевую ставку в параметре `bid`.
   *
   * Подробнее о том, как работает буст продаж, читайте в [Справке Маркета для продавцов](https://yandex.ru/support/marketplace/marketing/campaigns.html).
   *
   * {% note info "Как посмотреть расходы на буст продаж?" %}
   *
   * Фактические расходы на буст указаны в отчете по заказам ([POST campaigns/{campaignId}/stats/orders](../../reference/stats/getOrdersStats.md)). Сумма содержится в поле `bidFee`.
   *
   * {% endnote %}
   *
   * В одном запросе может быть максимум 1500 товаров.
   *
   * |**⚙️ Лимит:** 1 000 запросов в минуту|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param requestBody description
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Все получилось: ставки установлены или обновлены. Если нужно, добавлены новые товары и запущена кампания.
   *
   * @throws ApiError
   */
  public static putBidsForBusiness(
    businessId: number,
    requestBody: paths_1campaigns_1_campaignId_1bids_put_requestBody_content_application_1json_schema,
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/businesses/{businessId}/bids',
      path: {
        businessId: businessId,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        404: `Запрашиваемый ресурс не найден.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Включение буста продаж и установка ставок для магазина
   * {% include notitle [access](../../_auto/method_scopes/putBidsForCampaign.md) %}
   *
   * Запускает буст продаж в указанном магазине — создает и включает кампанию, добавляет в нее товары и назначает на них ставки.
   *
   * При первом использовании запроса Маркет: создаст кампанию, добавит в нее товары с указанными ставками для заданного магазина, включит для них ценовую стратегию и запустит продвижение. Повторное использование запроса позволит обновить ставки на товары в этой кампании или добавить новые. Подробнее о ценовой стратегии читайте в [Справке Маркета для продавцов](https://yandex.ru/support/marketplace/marketing/campaigns.html#price-strategy).
   *
   * Если товара с указанным SKU нет, он будет проигнорирован. Если в будущем в каталоге появится товар с таким SKU, он автоматически будет добавлен в кампанию с указанной ставкой.
   *
   * Запрос всегда работает с одной и той же кампанией, созданной через этот запрос или [PUT businesses/{businessId}/bids](/reference/bids/putBidsForBusiness). Если в кабинете удалить ее, при следующем выполнении запроса Маркет создаст новую. У созданной через API кампании всегда наибольший приоритет над остальными — изменить его нельзя.
   *
   * Выполнение запроса включает кампанию и ценовую стратегию, если они были отключены.
   *
   * Внести другие изменения в созданную через API кампанию можно в кабинете:
   *
   * * выключить или включить кампанию;
   * * изменить ее название;
   * * выключить или включить ценовую стратегию.
   *
   * Чтобы остановить продвижение отдельных товаров и удалить их из кампании, передайте для них нулевую ставку в параметре `bid`.
   *
   * Подробнее о том, как работает буст продаж, читайте в [Справке Маркета для продавцов](https://yandex.ru/support/marketplace/marketing/campaigns.html).
   *
   * {% note info "Как посмотреть расходы на буст продаж?" %}
   *
   * Фактические расходы на буст указаны в отчете по заказам ([POST campaigns/{campaignId}/stats/orders](../../reference/stats/getOrdersStats.md)). Сумма содержится в поле `bidFee`.
   *
   * {% endnote %}
   *
   * В одном запросе может быть максимум 1500 товаров.
   *
   * |**⚙️ Лимит:** 1 000 запросов в минуту|
   * |-|
   *
   * @param campaignId Идентификатор кампании.
   *
   * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
   *
   * * **Модули и API** → блок **Передача данных Маркету**.
   * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
   *
   * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
   *
   * @param requestBody description
   * @returns any Пустой ответ.
   * @throws ApiError
   */
  public static putBidsForCampaign(
    campaignId: number,
    requestBody: {
      /**
       * Список товаров и ставки для продвижения, которые на них нужно установить.
       */
      bids: Array<{
        /**
         * SKU товара, которому соответствует ставка из параметра `bid`.
         */
        sku: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Значение ставки для товара из параметра `sku`, от 50 до 9999.
         *
         * Указывается в процентах от стоимости товара и умножается на 100. Например, ставка 5% обозначается как 500.
         *
         */
        bid: number;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/bids',
      path: {
        campaignId: campaignId,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        404: `Запрашиваемый ресурс не найден.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Информация об установленных ставках
   * {% include notitle [access](../../_auto/method_scopes/getBidsInfoForBusiness.md) %}
   *
   * Возвращает значения ставок для заданных товаров.
   *
   * {% note warning "Получить информацию по кампаниям, созданным в кабинете, не получится" %}
   *
   * В ответе возвращаются значения только тех ставок, которые вы установили через запрос [PUT businesses/{businessId}/bids](../../reference/bids/putBidsForBusiness.md).
   *
   * {% endnote %}
   *
   * В одном запросе может быть максимум 1500 товаров.
   *
   * |**⚙️ Лимит:** 1 000 запросов в минуту|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param pageToken Идентификатор страницы c результатами.
   *
   * Если параметр не указан, возвращается первая страница.
   *
   * Рекомендуем передавать значение выходного параметра `nextPageToken`, полученное при последнем запросе.
   *
   * Если задан `page_token` и в запросе есть параметры `page_number` и `page_size`, они игнорируются.
   *
   * @param limit Количество значений на одной странице.
   *
   * @param requestBody description
   * @returns any Значения ставок для заданных товаров. В ответ попадают только товары, на которые установлены ставки.
   * @throws ApiError
   */
  public static getBidsInfoForBusiness(
    businessId: number,
    pageToken?: string,
    limit?: number,
    requestBody?: {
      /**
       * Список товаров, для которых нужно получить значения ставок.
       *
       * Если список не задан, постранично возвращаются все товары со ставками.
       *
       * Если список задан, результаты возвращаются одной страницей, а параметры `page_token` и `limit` игнорируются.
       *
       */
      skus?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/bids/info',
      path: {
        businessId: businessId,
      },
      query: {
        page_token: pageToken,
        limit: limit,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        404: `Запрашиваемый ресурс не найден.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Рекомендованные ставки для заданных товаров
   * {% include notitle [access](../../_auto/method_scopes/getBidsRecommendations.md) %}
   *
   * Возвращает рекомендованные ставки для заданных товаров, что обеспечивает вашим предложениям определенную долю показов, и дополнительные инструменты продвижения.
   *
   * Для одного товара может возвращаться одна рекомендованная ставка или несколько. Во втором случае разные ставки предназначены для достижения разной доли показов и получения дополнительных инструментов продвижения.
   *
   * Если товар только добавлен в каталог, но пока не продается, рекомендованной ставки для него не будет.
   *
   * В одном запросе может быть максимум 1500 товаров.
   *
   * |**⚙️ Лимит:** 1 000 запросов в минуту|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param requestBody description.
   * @returns any Рекомендованные ставки для заданных товаров.
   * @throws ApiError
   */
  public static getBidsRecommendations(
    businessId: number,
    requestBody: {
      /**
       * Список товаров, для которых нужно получить рекомендации по ставкам.
       *
       */
      skus: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/bids/recommendations',
      path: {
        businessId: businessId,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        404: `Запрашиваемый ресурс не найден.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
}
