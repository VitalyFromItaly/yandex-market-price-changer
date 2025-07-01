/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WarehousesService {
    /**
     * @deprecated
     * Список складов и групп складов
     * {% include notitle [access](../../_auto/method_scopes/getWarehouses.md) %}
     *
     * {% note warning "Какой метод использовать вместо устаревшего" %}
     *
     * [POST businesses/{businessId}/warehouses](../../reference/warehouses/getPagedWarehouses.md)
     *
     * {% endnote %}
     *
     * Возвращает список складов и, если склады объединены, список групп складов. [Что такое группы складов и зачем они нужны](https://yandex.ru/support/marketplace/assortment/operations/stocks.html#unified-stocks)
     *
     * Среди прочего запрос позволяет определить идентификатор, который нужно использовать при передаче остатков для группы складов.
     *
     * |**⚙️ Лимит:** 100 запросов в минуту|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @returns any Список складов и групп складов.
     * @throws ApiError
     */
    public static getWarehouses(
        businessId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/businesses/{businessId}/warehouses',
            path: {
                'businessId': businessId,
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
     * Список складов
     * {% include notitle [access](../../_auto/method_scopes/getPagedWarehouses.md) %}
     *
     * Возвращает список складов и информацию о них.
     *
     * {% note warning "Ограничение для параметра `limit`" %}
     *
     * Не передавайте значение больше 25.
     *
     * {% endnote %}
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
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
     * @returns any Список складов и их свойства, которые вы запрашивали.
     * @throws ApiError
     */
    public static getPagedWarehouses(
        businessId: number,
        pageToken?: string,
        limit?: number,
        requestBody?: {
            /**
             * Свойства складов, которые необходимо вернуть. Если какое-то значение параметра не задано, этой информации в ответе не будет.
             *
             * Передавайте параметр, только если нужна информация, которую он возвращает.
             *
             * Можно передать сразу несколько значений.
             *
             */
            components?: Array<'ADDRESS' | 'STATUS'> | null;
            /**
             * Список идентификаторов кампании тех магазинов, склады которых необходимо вернуть.
             *
             * Их можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
             *
             * * **Модули и API** → блок **Передача данных Маркету**.
             * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
             *
             * ⚠️ Не используйте вместо них идентификаторы магазинов, которые указаны в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
             *
             */
            campaignIds?: Array<number> | null;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/warehouses',
            path: {
                'businessId': businessId,
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
     * Идентификаторы складов Маркета
     * {% include notitle [access](../../_auto/method_scopes/getFulfillmentWarehouses.md) %}
     *
     * Возвращает список складов Маркета с их идентификаторами.
     *
     * |**⚙️ Лимит:** 100 запросов в минуту|
     * |-|
     *
     * @returns any Список складов.
     * @throws ApiError
     */
    public static getFulfillmentWarehouses(): CancelablePromise<{
        /**
         * Тип ответа.
         * Возможные значения:
         * * `OK` — ошибок нет.
         * * `ERROR` — при обработке запроса произошла ошибка.
         *
         */
        status?: 'OK' | 'ERROR';
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/warehouses',
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
     * Изменение статуса склада
     * {% include notitle [access](../../_auto/method_scopes/updateWarehouseStatus.md) %}
     *
     * Отключает или включает склад.
     *
     * После отключения склада товары, которые находятся на нем, скрываются через 15 минут. После включения они возвращаются на витрину через 15 минут, а если склад был выключен 30 дней или дольше — через 4 часа.
     *
     * |**⚙️ Лимит:** 100 запросов в час|
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
     * @returns any Новый статус склада.
     * @throws ApiError
     */
    public static updateWarehouseStatus(
        campaignId: number,
        requestBody: {
            /**
             * Статус склада:
             *
             * * `true` — включен.
             * * `false` — отключен.
             *
             */
            enabled: boolean;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/warehouse/status',
            path: {
                'campaignId': campaignId,
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
