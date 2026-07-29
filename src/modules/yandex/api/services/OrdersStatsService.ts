/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OrdersStatsService {
  /**
   * Детальная информация по заказам
   * {% include notitle [access](../../_auto/method_scopes/getOrdersStats.md) %}
   *
   * Возвращает информацию по заказам на Маркете, в которых есть ваши товары.
   *
   * С помощью нее вы можете собрать статистику по вашим заказам и узнать, например, какие из товаров чаще всего возвращаются покупателями, какие, наоборот, пользуются большим спросом и т. п.
   *
   * {% note tip "Информация по созданным или обновленным заказам может появиться с задержкой до 40 минут" %}
   *
   * Чтобы получить данные без задержки, используйте [метод получения информации о заказах](../../reference/orders/getOrders.md).
   *
   * {% endnote %}
   *
   * В одном запросе можно получить информацию не более чем по 200 заказам.
   *
   * |**⚙️ Лимит:** 1 000 000 заказов в час|
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
   * @returns any Информация по заказам.
   * @throws ApiError
   */
  public static getOrdersStats(
    campaignId: number,
    pageToken?: string,
    limit?: number,
    requestBody?: {
      /**
       * Начальная дата, когда заказ был сформирован.
       *
       * Формат даты: `ГГГГ‑ММ‑ДД`.
       *
       * Нельзя использовать вместе с параметрами `updateFrom` и `updateTo`.
       *
       */
      dateFrom?: string;
      /**
       * Конечная дата, когда заказ был сформирован.
       *
       * Формат даты: `ГГГГ‑ММ‑ДД`.
       *
       * Нельзя использовать вместе с параметрами `updateFrom` и `updateTo`.
       *
       */
      dateTo?: string;
      /**
       * Начальная дата периода, за который были изменения в заказе (например, статуса или информации о платежах).
       *
       * Формат даты: `ГГГГ‑ММ‑ДД`.
       *
       * Нельзя использовать вместе с параметрами `dateFrom` и `dateTo`.
       *
       */
      updateFrom?: string;
      /**
       * Конечная дата периода, за который были изменения в заказе (например, статуса или информации о платежах).
       *
       * Формат даты: `ГГГГ‑ММ‑ДД`.
       *
       * Нельзя использовать вместе с параметрами `dateFrom` и `dateTo`.
       *
       */
      updateTo?: string;
      /**
       * Список идентификаторов заказов.
       */
      orders?: Array<number> | null;
      /**
       * Список статусов заказов.
       */
      statuses?: Array<
        | 'CANCELLED_BEFORE_PROCESSING'
        | 'CANCELLED_IN_DELIVERY'
        | 'CANCELLED_IN_PROCESSING'
        | 'DELIVERY'
        | 'DELIVERED'
        | 'PARTIALLY_DELIVERED'
        | 'PARTIALLY_RETURNED'
        | 'PENDING'
        | 'PICKUP'
        | 'PROCESSING'
        | 'RESERVED'
        | 'RETURNED'
        | 'UNKNOWN'
        | 'UNPAID'
        | 'LOST'
      > | null;
      /**
       * Нужно ли вернуть только те заказы, в составе которых есть хотя бы один товар с кодом идентификации в системе [«Честный ЗНАК»](https://честныйзнак.рф/) или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go):
       *
       * * `true` — да.
       * * `false` — нет.
       * Такие коды присваиваются товарам, которые подлежат маркировке и относятся к определенным категориям.
       *
       */
      hasCis?: boolean;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/stats/orders',
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
}
