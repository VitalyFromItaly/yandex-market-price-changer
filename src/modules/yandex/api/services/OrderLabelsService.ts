/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1reports_1documents_1labels_1generate_post_parameters_0_schema } from '../models/paths_1reports_1documents_1labels_1generate_post_parameters_0_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OrderLabelsService {
  /**
   * Готовый ярлык‑наклейка для коробки в заказе
   * {% include notitle [access](../../_auto/method_scopes/generateOrderLabel.md) %}
   *
   * Формирует ярлык‑наклейку для коробки в заказе и возвращает ярлык в PDF‑файле.
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
   * @param shipmentId Идентификатор грузоместа.
   * @param boxId Идентификатор коробки.
   * @param format Настройка размещения ярлыков на странице. Если параметра нет, возвращается PDF с ярлыками формата A7.
   * @returns binary PDF‑файл с ярлыками для коробки. Файл содержит одну страницу с ярлыком.
   * @throws ApiError
   */
  public static generateOrderLabel(
    campaignId: number,
    orderId: number,
    shipmentId: number,
    boxId: number,
    format?: paths_1reports_1documents_1labels_1generate_post_parameters_0_schema,
  ): CancelablePromise<Blob> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/shipments/{shipmentId}/boxes/{boxId}/label',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        shipmentId: shipmentId,
        boxId: boxId,
      },
      query: {
        format: format,
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
   * Готовые ярлыки‑наклейки на все коробки в одном заказе
   * {% include notitle [access](../../_auto/method_scopes/generateOrderLabels.md) %}
   *
   * Возвращает PDF-файл с ярлыками, которые нужно наклеить на коробки перед отгрузкой. Подробно о том, зачем они нужны и как выглядят, рассказано [в Справке Маркета для продавцов](https://yandex.ru/support/marketplace/orders/fbs/packaging/marking.html).
   *
   * На вход нужно передать идентификатор заказа и один необязательный параметр, который управляет версткой PDF-файла.
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
   * @param format Настройка размещения ярлыков на странице. Если параметра нет, возвращается PDF с ярлыками формата A7.
   * @returns binary PDF‑файл с ярлыками на все коробки.
   * @throws ApiError
   */
  public static generateOrderLabels(
    campaignId: number,
    orderId: number,
    format?: paths_1reports_1documents_1labels_1generate_post_parameters_0_schema,
  ): CancelablePromise<Blob> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/labels',
      path: {
        campaignId: campaignId,
        orderId: orderId,
      },
      query: {
        format: format,
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
   * Данные для самостоятельного изготовления ярлыков
   * {% include notitle [access](../../_auto/method_scopes/getOrderLabelsData.md) %}
   *
   * Возвращает информацию на ярлыках, которые клеятся на коробки в заказе.
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
   * @returns any Информация для печати ярлыков.
   * @throws ApiError
   */
  public static getOrderLabelsData(
    campaignId: number,
    orderId: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/labels/data',
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
}
