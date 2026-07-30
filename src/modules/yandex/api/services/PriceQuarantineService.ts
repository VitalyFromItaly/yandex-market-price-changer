/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_cardStatuses_items } from '../models/paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_cardStatuses_items';
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1price_quarantine_1confirm_post_requestBody_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1price_quarantine_1confirm_post_requestBody_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1price_quarantine_post_requestBody_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1price_quarantine_post_requestBody_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1price_quarantine_post_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1price_quarantine_post_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PriceQuarantineService {
  /**
   * Список товаров, находящихся в карантине по цене в кабинете
   * {% include notitle [access](../../_auto/method_scopes/getBusinessQuarantineOffers.md) %}
   *
   * Возвращает список товаров, которые находятся в карантине по цене, установленной для всех магазинов кабинета.
   *
   * Проверьте цену каждого из товаров, который попал в карантин. Если ошибки нет и цена правильная, подтвердите ее с помощью запроса [POST businesses/{businessId}/price-quarantine/confirm](../../reference/business-assortment/confirmBusinessPrices.md). Если цена в самом деле ошибочная, установите верную с помощью запроса [POST businesses/{businessId}/offer-prices/updates](../../reference/business-assortment/updateBusinessPrices.md).
   *
   * {% note info "Что такое карантин?" %}
   *
   * Товар попадает в карантин, если его цена меняется слишком резко или слишком сильно отличается от рыночной. [Подробнее](https://yandex.ru/support/marketplace/assortment/operations/prices.html#quarantine)
   *
   * {% endnote %}
   *
   * В запросе можно использовать фильтры.
   *
   * Результаты возвращаются постранично.
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 500 товаров в одном запросе|
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
   * @returns paths_1campaigns_1_campaignId_1price_quarantine_post_responses_200_content_application_1json_schema Список товаров в карантине.
   * @throws ApiError
   */
  public static getBusinessQuarantineOffers(
    businessId: number,
    requestBody: paths_1campaigns_1_campaignId_1price_quarantine_post_requestBody_content_application_1json_schema,
    pageToken?: string,
    limit?: number,
  ): CancelablePromise<paths_1campaigns_1_campaignId_1price_quarantine_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/price-quarantine',
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
   * Удаление товара из карантина по цене в кабинете
   * {% include notitle [access](../../_auto/method_scopes/confirmBusinessPrices.md) %}
   *
   * Подтверждает во всех магазинах цену на товары, которые попали в карантин, и удаляет их из карантина.
   *
   * Товар попадает в карантин, если его цена меняется слишком резко. [Как настроить карантин](https://yandex.ru/support/marketplace/assortment/operations/prices.html#quarantine)
   *
   * Чтобы увидеть список товаров, которые попали в карантин, используйте запрос [POST businesses/{businessId}/price-quarantine](getBusinessQuarantineOffers.md).
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 200 товаров в одном запросе|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Ответ 200 обозначает, что цены подтверждены.
   * @throws ApiError
   */
  public static confirmBusinessPrices(
    businessId: number,
    requestBody: paths_1campaigns_1_campaignId_1price_quarantine_1confirm_post_requestBody_content_application_1json_schema,
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/price-quarantine/confirm',
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
   * Список товаров, находящихся в карантине по цене в магазине
   * {% include notitle [access](../../_auto/method_scopes/getCampaignQuarantineOffers.md) %}
   *
   * Возвращает список товаров, которые находятся в карантине по цене, установленной в заданном магазине.
   *
   * Проверьте цену каждого из товаров, который попал в карантин. Если ошибки нет и цена правильная, подтвердите ее с помощью запроса [POST campaigns/{campaignId}/price-quarantine/confirm](../../reference/assortment/confirmCampaignPrices.md). Если цена в самом деле ошибочная, установите верную с помощью запроса [POST campaigns/{campaignId}/offer-prices/updates](../../reference/assortment/updatePrices.md).
   *
   * {% note info "Что такое карантин?" %}
   *
   * Товар попадает в карантин, если его цена меняется слишком резко или слишком сильно отличается от рыночной. [Подробнее](https://yandex.ru/support/marketplace/assortment/operations/prices.html#quarantine)
   *
   * {% endnote %}
   *
   * В запросе можно использовать фильтры.
   *
   * Результаты возвращаются постранично.
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
   * @returns any Список товаров в карантине.
   * @throws ApiError
   */
  public static getCampaignQuarantineOffers(
    campaignId: number,
    requestBody: {
      /**
       * Идентификаторы товаров, информация о которых нужна.
       * <br><br>
       * ⚠️ Не используйте это поле одновременно с фильтрами по статусам карточек, категориям, брендам или тегам. Если вы хотите воспользоваться фильтрами, оставьте поле пустым.
       *
       */
      offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
      /**
       * Фильтр по статусам карточек.
       *
       * [Что такое карточка товара](https://yandex.ru/support/marketplace/assortment/content/index.html)
       *
       */
      cardStatuses?: Array<paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_cardStatuses_items> | null;
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
      url: '/campaigns/{campaignId}/price-quarantine',
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
   * Удаление товара из карантина по цене в магазине
   * {% include notitle [access](../../_auto/method_scopes/confirmCampaignPrices.md) %}
   *
   * Подтверждает в заданном магазине цену на товары, которые попали в карантин, и удаляет их из карантина.
   *
   * Товар попадает в карантин, если его цена меняется слишком резко. [Как настроить карантин](https://yandex.ru/support/marketplace/assortment/operations/prices.html#quarantine)
   *
   * Чтобы увидеть список товаров, которые попали в карантин, используйте запрос [POST campaigns/{campaignId}/price-quarantine](getCampaignQuarantineOffers.md).
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
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Ответ 200 обозначает, что цены подтверждены.
   * @throws ApiError
   */
  public static confirmCampaignPrices(
    campaignId: number,
    requestBody: {
      /**
       * Идентификаторы товаров, у которых подтверждается цена.
       */
      offerIds: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/price-quarantine/confirm',
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
}
