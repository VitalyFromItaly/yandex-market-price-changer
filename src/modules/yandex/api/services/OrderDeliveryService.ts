/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OrderDeliveryService {
  /**
   * Изменение даты доставки заказа
   * {% include notitle [access](../../_auto/method_scopes/setOrderDeliveryDate.md) %}
   *
   * Метод изменяет дату доставки заказа в статусе `PROCESSING` или `DELIVERY`. Для заказов с другими статусами дату доставки изменить нельзя.
   *
   * |**⚙️ Лимит:** 100 000 запросов в час|
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
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Успешное изменение даты доставки.
   * @throws ApiError
   */
  public static setOrderDeliveryDate(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Информация о новой дате доставки заказа.
       */
      dates: {
        /**
         * Новая дата доставки заказа.
         *
         * Формат даты: `ГГГГ-ММ-ДД`.
         *
         */
        toDate: string;
      };
      /**
       * Причина переноса доставки заказа.
       */
      reason: 'USER_MOVED_DELIVERY_DATES' | 'PARTNER_MOVED_DELIVERY_DATES';
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/date',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Передача трек‑номера посылки
   * {% include notitle [access](../../_auto/method_scopes/setOrderDeliveryTrackCode.md) %}
   *
   * Передает Маркету трек‑номер, по которому покупатель может отследить посылку со своим заказом через службу доставки. Если покупатели смогут узнать, на каком этапе доставки находятся их заказы, доверие покупателей к вашему магазину может возрасти.
   *
   * Передать трек‑номер можно, только если заказ находится в статусе `PROCESSING`, `DELIVERY` или `PICKUP`.
   *
   * |**⚙️ Лимит:** 100 000 запросов в час|
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
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Трек‑номер посылки и идентификатор службы доставки были успешно переданы.
   * @throws ApiError
   */
  public static setOrderDeliveryTrackCode(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Трек‑номер посылки.
       */
      trackCode: string;
      /**
       * Идентификатор службы доставки. Информацию о службе доставки можно получить с помощью запроса [GET delivery/services](../../reference/orders/getDeliveryServices.md).
       */
      deliveryServiceId: number;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/track',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Информация о покупателе — физическом лице
   * {% include notitle [access](../../_auto/method_scopes/getOrderBuyerInfo.md) %}
   *
   * Возвращает информацию о покупателе по идентификатору заказа.
   *
   * {% note info "Как получить информацию о покупателе, который является юридическим лицом" %}
   *
   * Воспользуйтесь запросом [POST campaigns/{campaignId}/orders/{orderId}/business-buyer](../../reference/order-business-information/getOrderBusinessBuyerInfo.md).
   *
   * {% endnote %}
   *
   * Получить данные можно, только если заказ находится в статусе `PROCESSING`, `DELIVERY` или `PICKUP`.
   *
   * |**⚙️ Лимит:** 3 000 запросов в час|
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
   * @returns any Информация о покупателе.
   * @throws ApiError
   */
  public static getOrderBuyerInfo(
    campaignId: number,
    orderId: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/buyer',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Передача кода подтверждения
   * {% include notitle [access](../../_auto/method_scopes/verifyOrderEac.md) %}
   *
   * Отправляет Маркету код подтверждения для его проверки.
   *
   * **Если у магазина настроена работа с кодами подтверждения:**
   *
   * В запросах [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md), [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md), [PUT campaigns/{campaignId}/orders/{orderId}/status](../../reference/orders/updateOrderStatus.md) в параметре `delivery`, вложенном в `order`, возвращается параметр `eacType` с типом `Enum` — тип кода подтверждения для передачи заказа.
   *
   * Возможные значения:
   *
   * * `MERCHANT_TO_COURIER` (временно не возвращается) — продавец передает код курьеру для получения невыкупа;
   * * `COURIER_TO_MERCHANT` — курьер передает код продавцу для получения заказа.
   *
   * Параметр `eacType` возвращается при статусах заказа `COURIER_FOUND`, `COURIER_ARRIVED_TO_SENDER` и `DELIVERY_SERVICE_UNDELIVERED`. Если заказ в других статусах, параметр может отсутствовать.
   *
   * |**⚙️ Лимит:** 100 000 запросов в час|
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
   * @param requestBody
   * @returns any Проверка кода выполнена успешно.
   * @throws ApiError
   */
  public static verifyOrderEac(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Код для подтверждения ЭАПП.
       */
      code: string;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/verifyEac',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Продление срока хранения заказа
   * {% include notitle [access](../../_auto/method_scopes/updateOrderStorageLimit.md) %}
   *
   * Продлевает срок хранения заказа в пункте выдачи продавца.
   *
   * Заказ должен быть в статусе `PICKUP`. Продлить срок можно только один раз, не больше чем на 30 дней.
   *
   * Новый срок хранения можно получить в параметре `outletStorageLimitDate` запроса [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).
   *
   * |**⚙️ Лимит:** 100 000 запросов в час|
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
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
   * @throws ApiError
   */
  public static updateOrderStorageLimit(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Новая дата, до которой заказ будет храниться в пункте выдачи.
       *
       * Срок хранения можно увеличить не больше, чем на 30 дней.
       *
       * Формат даты: `ГГГГ-ММ-ДД`.
       *
       */
      newDate: string;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/storage-limit',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
