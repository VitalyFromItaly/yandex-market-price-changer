/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class GoodsStatsService {
  /**
   * Отчет по товарам
   * {% include notitle [access](../../_auto/method_scopes/getGoodsStats.md) %}
   *
   * Возвращает подробный отчет по товарам, которые вы разместили на Маркете. С помощью отчета вы можете узнать, например, об остатках на складе, об условиях хранения ваших товаров и т. д.
   *
   * |**⚙️ Лимит:** 5 000 товаров в минуту|
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
   * @returns any Отчет по товарам.
   * @throws ApiError
   */
  public static getGoodsStats(
    campaignId: number,
    requestBody: {
      /**
       * Список ваших идентификаторов SKU.
       *
       */
      shopSkus: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/stats/skus',
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
