/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ReturnsService {
  /**
   * Список невыкупов и возвратов
   * {% include notitle [access](../../_auto/method_scopes/getReturns.md) %}
   *
   * Получает список невыкупов и возвратов.
   *
   * Чтобы получить информацию по одному невыкупу или возврату, выполните запрос [GET campaigns/{campaignId}/orders/{orderId}/returns/{returnId}](../../reference/orders/getReturn.md).
   *
   * {% note tip "Подключите API-уведомления" %}
   *
   * Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда появится новый невыкуп или возврат.
   *
   * [{#T}](../../push-notifications/index.md)
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderIds Идентификаторы заказов — для фильтрации результатов.
   *
   * Несколько идентификаторов перечисляются через запятую без пробела.
   *
   * @param statuses Статусы невыкупов или возвратов — для фильтрации результатов.
   *
   * Несколько статусов перечисляются через запятую.
   *
   * @param type Тип заказа для фильтрации:
   *
   * * `UNREDEEMED` — невыкуп.
   *
   * * `RETURN` — возврат.
   *
   * Если не указать, в ответе будут и невыкупы, и возвраты.
   *
   * @param fromDate Начальная дата для фильтрации невыкупов или возвратов по дате обновления.
   *
   * Формат: `ГГГГ-ММ-ДД`.
   *
   * @param toDate Конечная дата для фильтрации невыкупов или возвратов по дате обновления.
   *
   * Формат: `ГГГГ-ММ-ДД`.
   *
   * @param fromDate {% note warning "Вместо него используйте `fromDate`." %}
   *
   *
   *
   * {% endnote %}
   *
   * Начальная дата для фильтрации невыкупов или возвратов по дате обновления.
   *
   * @param toDate {% note warning "Вместо него используйте `toDate`." %}
   *
   *
   *
   * {% endnote %}
   *
   * Конечная дата для фильтрации невыкупов или возвратов по дате обновления.
   *
   * @returns any Постраничные невыкупы или возвраты магазина.
   * @throws ApiError
   */
  public static getReturns(
    campaignId: number,
    pageToken?: string,
    limit?: number,
    orderIds?: Array<number>,
    statuses?: Array<
      | 'STARTED_BY_USER'
      | 'REFUND_IN_PROGRESS'
      | 'REFUNDED'
      | 'FAILED'
      | 'WAITING_FOR_DECISION'
      | 'DECISION_MADE'
      | 'REFUNDED_WITH_BONUSES'
      | 'REFUNDED_BY_SHOP'
      | 'CANCELLED'
      | 'REJECTED'
      | 'COMPLETE_WITHOUT_REFUND'
      | 'PREMODERATION_DISPUTE'
      | 'PREMODERATION_DECISION_WAITING'
      | 'PREMODERATION_DECISION_MADE'
      | 'PREMODERATION_SELECT_DELIVERY'
      | 'UNKNOWN'
    >,
    type?: 'UNREDEEMED' | 'RETURN',
    fromDate?: string,
    toDate?: string,
    fromDate?: string,
    toDate?: string,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/returns',
      path: {
        campaignId: campaignId,
      },
      query: {
        page_token: pageToken,
        limit: limit,
        orderIds: orderIds,
        statuses: statuses,
        type: type,
        fromDate: fromDate,
        toDate: toDate,
        from_date: fromDate,
        to_date: toDate,
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
   * Информация о невыкупе или возврате
   * {% include notitle [access](../../_auto/method_scopes/getReturn.md) %}
   *
   * Получает информацию по одному невыкупу или возврату.
   *
   * {% note tip "Подключите API-уведомления" %}
   *
   * Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда появится новый невыкуп или возврат.
   *
   * [{#T}](../../push-notifications/index.md)
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param returnId Идентификатор невыкупа или возврата.
   * @returns any Детали невыкупа или возврата.
   * @throws ApiError
   */
  public static getReturn(
    campaignId: number,
    orderId: number,
    returnId: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/returns/{returnId}',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        returnId: returnId,
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
   * Принятие или изменение решения по возврату
   * {% include notitle [access](../../_auto/method_scopes/setReturnDecision.md) %}
   *
   * Выбирает решение по возврату от покупателя. После этого для подтверждения решения нужно выполнить запрос [POST campaigns/{campaignId}/orders/{orderId}/returns/{returnId}/decision/submit](../../reference/orders/submitReturnDecision.md).
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param returnId Идентификатор невыкупа или возврата.
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Детали возврата.
   * @throws ApiError
   */
  public static setReturnDecision(
    campaignId: number,
    orderId: number,
    returnId: number,
    requestBody: {
      /**
       * Идентификатор товара в возврате.
       */
      returnItemId: number;
      /**
       * Решение по товару в возврате.
       */
      decisionType:
        | 'FAST_REFUND_MONEY'
        | 'REFUND_MONEY'
        | 'REFUND_MONEY_INCLUDING_SHIPMENT'
        | 'REPAIR'
        | 'REPLACE'
        | 'SEND_TO_EXAMINATION'
        | 'DECLINE_REFUND'
        | 'OTHER_DECISION';
      /**
       * Комментарий к решению. Укажите:
       *
       * * для `REFUND_MONEY_INCLUDING_SHIPMENT`— стоимость обратной пересылки.
       *
       * * для `REPAIR` — когда вы устраните недостатки товара.
       *
       * * для `DECLINE_REFUND` — причину отказа.
       *
       * * для `OTHER_DECISION` — какое решение вы предлагаете.
       *
       */
      comment?: string;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/{orderId}/returns/{returnId}/decision',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        returnId: returnId,
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
   * Подтверждение решения по возврату
   * {% include notitle [access](../../_auto/method_scopes/submitReturnDecision.md) %}
   *
   * Подтверждает выбранное решение по возврату, отправленное в запросе [POST campaigns/{campaignId}/orders/{orderId}/returns/{returnId}/decision](../../reference/orders/setReturnDecision.md).
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param returnId Идентификатор невыкупа или возврата.
   * @param requestBody description
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Статус выполнения операции.
   * @throws ApiError
   */
  public static submitReturnDecision(
    campaignId: number,
    orderId: number,
    returnId: number,
    requestBody?: Record<string, any>,
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/{orderId}/returns/{returnId}/decision/submit',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        returnId: returnId,
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
   * Получение заявления на возврат
   * {% include notitle [access](../../_auto/method_scopes/getReturnApplication.md) %}
   *
   * Загружает заявление покупателя на возврат товара.
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param returnId Идентификатор невыкупа или возврата.
   * @returns binary Заявление на возврат.
   * @throws ApiError
   */
  public static getReturnApplication(
    campaignId: number,
    orderId: number,
    returnId: number,
  ): CancelablePromise<Blob> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/returns/{returnId}/application',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        returnId: returnId,
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
   * Получение фотографий товаров в возврате
   * {% include notitle [access](../../_auto/method_scopes/getReturnPhoto.md) %}
   *
   * Получает фотографии товаров, которые покупатель приложил к заявлению на возврат.
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param returnId Идентификатор невыкупа или возврата.
   * @param itemId Идентификатор товара в возврате.
   * @param imageHash Хеш ссылки изображения для загрузки.
   * @returns binary Фотография товаров.
   * @throws ApiError
   */
  public static getReturnPhoto(
    campaignId: number,
    orderId: number,
    returnId: number,
    itemId: number,
    imageHash: string,
  ): CancelablePromise<Blob> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/returns/{returnId}/decision/{itemId}/image/{imageHash}',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        returnId: returnId,
        itemId: itemId,
        imageHash: imageHash,
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
}
