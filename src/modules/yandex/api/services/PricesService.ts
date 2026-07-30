/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1offers_1update_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_1_properties_vat } from '../models/paths_1campaigns_1_campaignId_1offers_1update_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_1_properties_vat';
import type { paths_1models_get_parameters_2_schema } from '../models/paths_1models_get_parameters_2_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PricesService {
  /**
   * Установка цен на товары для всех магазинов
   * {% include notitle [access](../../_auto/method_scopes/updateBusinessPrices.md) %}
   *
   * Устанавливает цены, которые действуют во всех магазинах. Чтобы получить рекомендации Маркета, касающиеся цен, выполните запрос [POST businesses/{businessId}/offers/recommendations](../../reference/business-assortment/getOfferRecommendations.md).
   *
   * При необходимости передавайте НДС с помощью параметра `vat` в запросе [POST campaigns/{campaignId}/offers/update](../../reference/assortment/updateCampaignOffers.md).
   *
   * {% note info "Данные в каталоге обновляются не мгновенно" %}
   *
   * Это занимает до нескольких минут.
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 500 товаров в одном запросе|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Маркет принял информацию о новых ценах.
   * @throws ApiError
   */
  public static updateBusinessPrices(
    businessId: number,
    requestBody: {
      /**
       * Список товаров с ценами.
       */
      offers: Array<{
        offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Цены.
         */
        price: {
          /**
           * Значение.
           */
          value: number;
          /**
           * Валюта.
           */
          currencyId: paths_1models_get_parameters_2_schema;
        };
      }>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/offer-prices/updates',
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
        423: `К ресурсу нельзя применить указанный метод.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Установка цен на товары в конкретном магазине
   * {% include notitle [access](../../_auto/method_scopes/updatePrices.md) %}
   *
   * Устанавливает цены на товары в магазине. Чтобы получить рекомендации Маркета, касающиеся цен, выполните запрос [POST businesses/{businessId}/offers/recommendations](../../reference/business-assortment/getOfferRecommendations.md).
   *
   * {% note warning "Метод только для отдельных магазинов" %}
   *
   * Вам доступен этот метод, если в кабинете продавца на Маркете есть возможность установить уникальные цены в отдельных магазинах. Как это проверить — в методе [POST businesses/{businessId}/settings](../../reference/businesses/getBusinessSettings.md) в параметре `onlyDefaultPrice` возвращается значение `false`.
   *
   * В ином случае используйте метод управления ценами, которые действуют во всех магазинах, — [POST businesses/{businessId}/offer-prices/updates](../../reference/business-assortment/updateBusinessPrices.md).
   *
   * {% endnote %}
   *
   * {% note info "Данные в каталоге обновляются не мгновенно" %}
   *
   * Это занимает до нескольких минут.
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту|
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
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Маркет принял информацию о новых ценах.
   * @throws ApiError
   */
  public static updatePrices(
    campaignId: number,
    requestBody: {
      /**
       * Список товаров.
       */
      offers: Array<{
        offerId?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Цена с указанием скидки, валюты и времени последнего обновления.
         */
        price?: {
          /**
           * Цена на товар.
           */
          value?: number;
          /**
           * Цена на товар без скидки.
           *
           * Число должно быть целым. Вы можете указать цену со скидкой от 5 до 99%.
           *
           * Передавайте этот параметр при каждом обновлении цены, если предоставляете скидку на товар.
           *
           */
          discountBase?: number;
          /**
           * Валюта, в которой указана цена на товар.
           *
           */
          currencyId?: paths_1models_get_parameters_2_schema;
          vat?: paths_1campaigns_1_campaignId_1offers_1update_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_1_properties_vat;
        };
      }>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offer-prices/updates',
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
        423: `К ресурсу нельзя применить указанный метод.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * @deprecated
   * Список цен
   * {% include notitle [access](../../_auto/method_scopes/getPrices.md) %}
   *
   * {% note warning "Какой метод использовать вместо устаревшего" %}
   *
   * [POST campaigns/{campaignId}/offer-prices](../../reference/assortment/getPricesByOfferIds.md)
   *
   * {% endnote %}
   *
   * Возвращает список цен, установленных вами на товары любым способом: например, через партнерский API или в файле с каталогом.
   *
   * {% note info "Как считается общее количество товаров" %}
   *
   * По данным за последние семь дней (не включая сегодня) и не может быть выше 2 миллионов.
   *
   * {% endnote %}
   *
   * Способы установки цен описаны [в Справке Маркета для продавцов](https://yandex.ru/support/marketplace/assortment/operations/prices.html).
   *
   * |**⚙️ Лимит:** 150 000 товаров в минуту|
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
   * @param archived Фильтр по нахождению в архиве.
   * @returns any Список всех товаров с установленными ценами.
   * @throws ApiError
   */
  public static getPrices(
    campaignId: number,
    pageToken?: string,
    limit?: number,
    archived: boolean = false,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/offer-prices',
      path: {
        campaignId: campaignId,
      },
      query: {
        page_token: pageToken,
        limit: limit,
        archived: archived,
      },
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
   * Просмотр цен на указанные товары в магазине
   * {% include notitle [access](../../_auto/method_scopes/getPricesByOfferIds.md) %}
   *
   * Возвращает список цен на указанные товары в магазине.
   *
   * {% note warning "Метод только для отдельных магазинов" %}
   *
   * Используйте этот метод, только если в кабинете установлены уникальные цены в отдельных магазинах.
   *
   * Для просмотра цен, которые действуют во всех магазинах, используйте [POST businesses/{businessId}/offer-mappings](../../reference/business-assortment/getOfferMappings.md).
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 150 000 товаров в минуту|
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
   * @param requestBody
   * @returns any Список товаров с установленными для заданного магазина ценами.
   * @throws ApiError
   */
  public static getPricesByOfferIds(
    campaignId: number,
    pageToken?: string,
    limit?: number,
    requestBody?: {
      /**
       * Список SKU.
       *
       * {% note warning "Такой список возвращается только целиком" %}
       *
       * Если вы запрашиваете информацию по конкретным SKU, не заполняйте:
       *
       * * `page_token`
       * * `limit`
       *
       * {% endnote %}
       *
       *
       *
       */
      offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offer-prices',
      path: {
        campaignId: campaignId,
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
   * @deprecated
   * Цены для продвижения товаров
   * {% include notitle [access](../../_auto/method_scopes/getSuggestedPrices.md) %}
   *
   * {% note warning "Не используйте его, это может привести к ошибкам. Информацию о ценах вы можете получить в помощью [отчета «Цены на рынке»](../../reference/reports/generatePricesReport.md)." %}
   *
   *
   *
   * {% endnote %}
   *
   * {% note warning "Метод только для некоторых магазинов" %}
   *
   * Этот метод подходит только тем магазинам, которые устанавливают цены на товары в рублях.
   *
   * {% endnote %}
   *
   * Возвращает цены для продвижения товаров, которые вы размещаете на Маркете.
   *
   * Товары, для которых нужно получить цены, передаются в теле POST-запроса.
   *
   * Цены для продвижения зависят от цен, установленных на товары другими партнерами. Если один товар поставляют несколько партнеров, на Маркете сначала продается товар с более низкой ценой. Когда закончится товар по низкой цене, начнет продаваться товар по более высокой цене.
   *
   * Выходные данные содержат для каждого товара несколько цен, соответствующих разным типам продвижения.
   *
   * Установить цены на товары можно с помощью запроса [POST campaigns/{campaignId}/offer-prices/updates](../../reference/assortment/updatePrices.md) или другими способами: например, указать их в файле с каталогом. Также вы можете использовать стратегии для автоматической установки рекомендованных цен или минимальных цен на Маркете.
   *
   * Подробно об автоматическом управлении ценами рассказано [в Справке Маркета для продавцов](https://yandex.ru/support/marketplace/marketing/prices.html).
   *
   * |**⚙️ Лимит:** 100 000 товаров в час|
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
   * @param requestBody
   * @returns any Список цен для продвижения на Маркете.
   * @throws ApiError
   */
  public static getSuggestedPrices(
    campaignId: number,
    requestBody: {
      /**
       * Список товаров.
       */
      offers: Array<{
        /**
         * Идентификатор предложения из прайс-листа.
         */
        offerId?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * SKU на Маркете.
         */
        marketSku?: number;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offer-prices/suggestions',
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
}
