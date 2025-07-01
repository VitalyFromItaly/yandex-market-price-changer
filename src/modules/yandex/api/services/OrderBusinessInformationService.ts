/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OrderBusinessInformationService {
    /**
     * Информация о покупателе — юридическом лице
     * {% include notitle [access](../../_auto/method_scopes/getOrderBusinessBuyerInfo.md) %}
     *
     * Возвращает информацию о покупателе по идентификатору заказа.
     *
     * {% note info "Как получить информацию о покупателе, который является физическим лицом" %}
     *
     * Воспользуйтесь запросом [GET campaigns/{campaignId}/orders/{orderId}/buyer](../../reference/orders/getOrderBuyerInfo.md).
     *
     * {% endnote %}
     *
     * Получить данные можно, только если заказ находится в статусе `PROCESSING`, `DELIVERY`, `PICKUP` или `DELIVERED`.
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
    public static getOrderBusinessBuyerInfo(
        campaignId: number,
        orderId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/orders/{orderId}/business-buyer',
            path: {
                'campaignId': campaignId,
                'orderId': orderId,
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
     * Информация о документах
     * {% include notitle [access](../../_auto/method_scopes/getOrderBusinessDocumentsInfo.md) %}
     *
     * Возвращает информацию о документах по идентификатору заказа.
     *
     * Получить данные можно после того, как заказ перейдет в статус `DELIVERED`.
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
     * @returns any Информация о документах.
     * @throws ApiError
     */
    public static getOrderBusinessDocumentsInfo(
        campaignId: number,
        orderId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/orders/{orderId}/documents',
            path: {
                'campaignId': campaignId,
                'orderId': orderId,
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
