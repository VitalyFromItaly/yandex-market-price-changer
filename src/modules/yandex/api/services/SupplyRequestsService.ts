/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1supply_requests_1items_post_requestBody_content_application_1json_schema_properties_requestId } from '../models/paths_1campaigns_1_campaignId_1supply_requests_1items_post_requestBody_content_application_1json_schema_properties_requestId';
import type { paths_1models_1offers_post_parameters_2_schema } from '../models/paths_1models_1offers_post_parameters_2_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SupplyRequestsService {
    /**
     * Получение информации о заявках на поставку, вывоз и утилизацию
     * {% include notitle [access](../../_auto/method_scopes/getSupplyRequests.md) %}
     *
     * По указанным фильтрам возвращает заявки на поставку, вывоз и утилизацию, а также информацию по ним.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
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
     * @returns any Список заявок и информация по ним.
     * @throws ApiError
     */
    public static getSupplyRequests(
        campaignId: number,
        pageToken?: string,
        limit?: number,
        requestBody?: {
            /**
             * Идентификаторы заявок.
             */
            requestIds?: Array<paths_1campaigns_1_campaignId_1supply_requests_1items_post_requestBody_content_application_1json_schema_properties_requestId> | null;
            /**
             * Дата начала периода для фильтрации заявок.
             */
            requestDateFrom?: string | null;
            /**
             * Дата окончания периода для фильтрации заявок.
             */
            requestDateTo?: string | null;
            /**
             * Типы заявок для фильтрации.
             */
            requestTypes?: Array<'SUPPLY' | 'WITHDRAW' | 'UTILIZATION'> | null;
            /**
             * Подтипы заявок для фильтрации.
             */
            requestSubtypes?: Array<'DEFAULT' | 'XDOC' | 'INVENTORYING_SUPPLY' | 'INVENTORYING_SUPPLY_WAREHOUSE_BASED_PER_SUPPLIER' | 'MOVEMENT_SUPPLY' | 'ADDITIONAL_SUPPLY' | 'VIRTUAL_DISTRIBUTION_CENTER' | 'VIRTUAL_DISTRIBUTION_CENTER_CHILD' | 'FORCE_PLAN' | 'FORCE_PLAN_ANOMALY_PER_SUPPLY' | 'PLAN_BY_SUPPLIER' | 'ANOMALY_WITHDRAW' | 'FIX_LOST_INVENTORYING' | 'OPER_LOST_INVENTORYING' | 'MOVEMENT_WITHDRAW' | 'MISGRADING_SUPPLY' | 'MISGRADING_WITHDRAW' | 'MAN_UTIL'> | null;
            /**
             * Статусы заявок для фильтрации.
             */
            requestStatuses?: Array<'CREATED' | 'FINISHED' | 'CANCELLED' | 'INVALID' | 'VALIDATED' | 'PUBLISHED' | 'ARRIVED_TO_SERVICE' | 'ARRIVED_TO_XDOC_SERVICE' | 'SHIPPED_TO_SERVICE' | 'CANCELLATION_REQUESTED' | 'CANCELLATION_REJECTED' | 'REGISTERED_IN_ELECTRONIC_QUEUE' | 'READY_FOR_UTILIZATION' | 'TRANSIT_MOVING' | 'WAREHOUSE_HANDLING' | 'ACCEPTED_BY_WAREHOUSE_SYSTEM' | 'READY_TO_WITHDRAW'> | null;
            /**
             * Параметры сортировки.
             */
            sorting?: {
                direction: paths_1models_1offers_post_parameters_2_schema;
                /**
                 * По какому параметру сортировать заявки:
                 *
                 * * `ID` — идентификатор заявки.
                 * * `REQUESTED_DATE` — дата поставки на склад хранения.
                 *
                 * Если товары проходили через транзитный склад, сортирует по датам поставки на оба склада.
                 * * `UPDATED_AT` — время обновления заявки.
                 * * `STATUS` — статус заявки.
                 *
                 */
                attribute: 'ID' | 'REQUESTED_DATE' | 'UPDATED_AT' | 'STATUS';
            };
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/supply-requests',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'page_token': pageToken,
                'limit': limit,
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
    /**
     * Получение товаров в заявке на поставку, вывоз или утилизацию
     * {% include notitle [access](../../_auto/method_scopes/getSupplyRequestItems.md) %}
     *
     * Возвращает список товаров в заявке и информацию по ним.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
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
     * @returns any Список товаров в заявке и информация по ним.
     * @throws ApiError
     */
    public static getSupplyRequestItems(
        campaignId: number,
        requestBody: {
            /**
             * Идентификатор заявки.
             *
             * {% note warning "Используется только в API" %}
             *
             * По нему не получится найти заявки в кабинете продавца на Маркете. Для этого используйте `marketplaceRequestId` или `warehouseRequestId`.
             *
             * {% endnote %}
             *
             */
            requestId: number;
        },
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/supply-requests/items',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'page_token': pageToken,
                'limit': limit,
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
     * Получение документов по заявке на поставку, вывоз или утилизацию
     * {% include notitle [access](../../_auto/method_scopes/getSupplyRequestDocuments.md) %}
     *
     * Возвращает документы по заявке.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
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
     * @returns any Список документов и ссылки на них.
     * @throws ApiError
     */
    public static getSupplyRequestDocuments(
        campaignId: number,
        requestBody: {
            requestId: paths_1campaigns_1_campaignId_1supply_requests_1items_post_requestBody_content_application_1json_schema_properties_requestId;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/supply-requests/documents',
            path: {
                'campaignId': campaignId,
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
