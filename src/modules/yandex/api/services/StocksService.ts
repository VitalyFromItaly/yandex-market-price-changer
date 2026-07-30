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
export class StocksService {
  /**
   * Передача информации об остатках
   * {% include notitle [access](../../_auto/method_scopes/updateStocks.md) %}
   *
   * Передает данные об остатках товаров на витрине.
   *
   * Для группы складов передавайте остатки только для **одного любого склада**. Информация для остальных складов в этой группе обновится автоматически.
   *
   * Обязательно указывайте SKU **в точности** так, как он указан в каталоге. Например, _557722_ и _0557722_ — это два разных SKU.
   *
   * {% note info "Данные в каталоге обновляются не мгновенно" %}
   *
   * Это занимает до нескольких минут.
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 100 000 товаров в минуту|
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
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
   * @throws ApiError
   */
  public static updateStocks(
    campaignId: number,
    requestBody: {
      /**
       * Данные об остатках товаров.
       *
       */
      skus: Array<{
        sku: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Информация об остатках товара.
         *
         */
        items: Array<{
          /**
           * Количество доступного товара.
           *
           */
          count: number;
          /**
           * Дата и время последнего обновления информации об остатках.
           * <br><br>
           * Если вы не передали параметр `updatedAt`, используется текущее время.
           * <br><br>
           * Формат даты и времени: ISO 8601 со смещением относительно UTC. Например, `2017-11-21T00:42:42+03:00`.
           *
           */
          updatedAt?: string;
        }>;
      }>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/offers/stocks',
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
   * Информация об остатках и оборачиваемости
   * {% include notitle [access](../../_auto/method_scopes/getStocks.md) %}
   *
   * Возвращает данные об остатках товаров (для всех моделей) и об [оборачиваемости](*turnover) товаров (для модели FBY).
   *
   * **Для модели FBY:** информация об остатках может возвращаться с нескольких складов Маркета, у которых будут разные `warehouseId`. Получить список складов Маркета можно с помощью метода [GET warehouses](../../reference/warehouses/getFulfillmentWarehouses.md).
   *
   * {% note info "По умолчанию данные по оборачивамости не возращаются" %}
   *
   * Чтобы они были в ответе, передавайте `true` в поле `withTurnover`.
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 100 000 товаров в минуту|
   * |-|
   *
   * [//]: <> (turnover: Среднее количество дней, за которое товар продается. Подробно об оборачиваемости рассказано в Справке Маркета для продавцов https://yandex.ru/support/marketplace/analytics/turnover.html.)
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
   * @returns any Остатки товаров на складах.
   * @throws ApiError
   */
  public static getStocks(
    campaignId: number,
    pageToken?: string,
    limit?: number,
    requestBody?: {
      /**
       * Идентификатор склада.
       *
       * Если параметр указан, возвращаются только товары в наличии на переданном складе.
       *
       * **Для модели FBY:** получить список складов Маркета можно с помощью метода [GET warehouses](../../reference/warehouses/getFulfillmentWarehouses.md).
       *
       */
      stocksWarehouseId?: number;
      /**
       * **Только для модели FBY**
       *
       * Возвращать ли информацию по оборачиваемости.
       *
       * Значение по умолчанию: `false`. Если информация нужна, передайте значение `true`.
       *
       */
      withTurnover?: boolean;
      /**
       * Фильтр по нахождению в архиве.
       *
       * Передайте `true`, чтобы получить информацию об остатках товаров, которые находятся в архиве. Если фильтр не заполнен или передано `false`, в ответе возвращается информация о товарах, которые не находятся в архиве.
       *
       */
      archived?: boolean;
      /**
       * Фильтр по вашим SKU товаров.
       *
       * Возвращается информация об остатках всех переданных SKU, включая товары в архиве.
       *
       * {% note warning "Такой список возвращается только целиком" %}
       *
       * Если вы запрашиваете информацию по конкретным SKU, не заполняйте:
       *
       * * `page_token`
       * * `limit`
       * * `archived`
       * * `stocksOnWarehouse`
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
      url: '/campaigns/{campaignId}/offers/stocks',
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
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
}
