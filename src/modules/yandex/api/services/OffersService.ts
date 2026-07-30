/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OffersService {
  /**
   * Информация о товарах, которые размещены в заданном магазине
   * {% include notitle [access](../../_auto/method_scopes/getCampaignOffers.md) %}
   *
   * Возвращает список товаров, которые размещены в заданном магазине. Для каждого товара указываются параметры размещения.
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту|
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
   * @returns any Список товаров, размещенных в заданном магазине.
   * @throws ApiError
   */
  public static getCampaignOffers(
    campaignId: number,
    requestBody: {
      /**
       * Идентификаторы товаров, информация о которых нужна.
       *
       * {% note warning "Такой список возвращается только целиком" %}
       *
       * Не используйте это поле одновременно с фильтрами по статусам карточек, категориям, брендам или тегам. Если вы хотите воспользоваться фильтрами, оставьте поле пустым.
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
      /**
       * Фильтр по статусам товаров.
       *
       */
      statuses?: Array<
        | 'PUBLISHED'
        | 'CHECKING'
        | 'DISABLED_BY_PARTNER'
        | 'DISABLED_AUTOMATICALLY'
        | 'REJECTED_BY_MARKET'
        | 'CREATING_CARD'
        | 'NO_CARD'
        | 'NO_STOCKS'
        | 'ARCHIVED'
      > | null;
      /**
       * Фильтр по категориям на Маркете.
       */
      categoryIds?: Array<number> | null;
      /**
       * Фильтр по брендам.
       */
      vendorNames?: Array<string> | null;
      /**
       * Фильтр по тегам.
       */
      tags?: Array<string> | null;
    },
    pageToken?: string,
    limit?: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offers',
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
   * Изменение условий продажи товаров в магазине
   * {% include notitle [access](../../_auto/method_scopes/updateCampaignOffers.md) %}
   *
   * Изменяет параметры продажи товаров в конкретном магазине: доступность товара, условия доставки и самовывоза, применяемый НДС.
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту|
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
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Ответ 200 обозначает, что новые параметры получены Маркетом и скоро вступят в силу.
   * @throws ApiError
   */
  public static updateCampaignOffers(
    campaignId: number,
    requestBody: {
      /**
       * Параметры размещения товаров в заданном магазине.
       */
      offers: Array<{
        offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Настройка продажи квантами. [Что это значит?](https://yandex.ru/support/marketplace/assortment/fields/quantum.html)
         */
        quantum?: {
          /**
           * Минимальное количество единиц товара в заказе. Например, если указать 10, покупатель сможет добавить в корзину не меньше 10 единиц.
           *
           * ⚠️ Если количество товара на складе меньше заданного, ограничение не сработает и покупатель сможет его заказать.
           *
           */
          minQuantity?: number;
          /**
           * На сколько единиц покупатель сможет увеличить количество товара в корзине.
           *
           * Например, если задать 5, покупатель сможет добавить к заказу только 5, 10, 15, ... единиц товара.
           *
           * ⚠️ Если количество товара на складе не дотягивает до кванта, ограничение не сработает и покупатель сможет заказать количество, не кратное кванту.
           *
           */
          stepQuantity?: number;
        };
        /**
         * {% note warning "Вместо него используйте методы скрытия товаров с витрины" %}
         *
         * * [GET campaigns/{campaignId}/hidden-offers](../../reference/assortment/getHiddenOffers.md) — просмотр скрытых товаров;
         * * [POST campaigns/{campaignId}/hidden-offers](../../reference/assortment/addHiddenOffers.md) — скрытие товаров;
         * * [POST campaigns/{campaignId}/hidden-offers/delete](../../reference/assortment/deleteHiddenOffers.md) — возобновление показа.
         *
         * {% endnote %}
         *
         * Есть ли товар в продаже.
         *
         * @deprecated
         */
        available?: boolean;
      }>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offers/update',
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
   * Удаление товаров из ассортимента магазина
   * {% include notitle [access](../../_auto/method_scopes/deleteCampaignOffers.md) %}
   *
   * Удаляет заданные товары из заданного магазина.
   *
   * {% note warning "Запрос удаляет товары из конкретного магазина" %}
   *
   * На продажи в других магазинах и на наличие товара в общем каталоге он не влияет.
   *
   * {% endnote %}
   *
   * Товар не получится удалить, если он хранится на складах Маркета.
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту|
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
   * @returns any Если удалось удалить не все товары, с ответом 200 вернется список тех, что были в запросе, но остались в магазине.
   * @throws ApiError
   */
  public static deleteCampaignOffers(
    campaignId: number,
    requestBody: {
      /**
       * Идентификаторы товаров в каталоге.
       */
      offerIds: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offers/delete',
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
   * Рекомендации Маркета, касающиеся цен
   * {% include notitle [access](../../_auto/method_scopes/getOfferRecommendations.md) %}
   *
   * Метод возвращает рекомендации нескольких типов.
   *
   * **1. Порог для привлекательной цены. Он нужен для участия в софинансировании скидок.**
   *
   * Показывает, какие **цены для участия** нужно установить, чтобы получить максимальные шансы на срабатывание скидок, софинансируемых Маркетом. [Как это устроено](https://yandex.ru/support/marketplace/marketing/smart-pricing.html#sponsored-discounts)
   *
   * **2. Оценка привлекательности цен на витрине.**
   *
   * Привлекательность влияет на вероятность срабатывания скидок за счет Маркета. [Как это устроено](https://yandex.ru/support/marketplace/marketing/smart-pricing.html#validation)
   *
   * В запросе можно использовать фильтры.
   *
   * Результаты возвращаются постранично.
   *
   * |**⚙️ Лимит:** 100 запросов в минуту|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param requestBody
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
   * @returns any Список товаров с рекомендациями.
   * @throws ApiError
   */
  public static getOfferRecommendations(
    businessId: number,
    requestBody: {
      /**
       * Идентификаторы товаров, информация о которых нужна. ⚠️ Не используйте это поле одновременно с остальными фильтрами. Если вы хотите воспользоваться фильтрами, оставьте поле пустым.
       */
      offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
      /**
       * Фильтр, выводящий товары, для которых заданы (`SPECIFIED`) или не заданы (`EMPTY`) цены для участия в софинансировании.
       */
      cofinancePriceFilter?: 'SPECIFIED' | 'EMPTY';
      /**
       * Фильтр, выводящий товары, с привлекательными, умеренными и непривлекательными ценами.
       */
      competitivenessFilter?: 'OPTIMAL' | 'AVERAGE' | 'LOW';
    },
    pageToken?: string,
    limit?: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/offers/recommendations',
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
}
