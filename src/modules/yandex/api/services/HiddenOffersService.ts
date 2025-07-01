/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1hidden_offers_post_requestBody_content_application_1json_schema_properties_hiddenOffers_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_post_requestBody_content_application_1json_schema_properties_hiddenOffers_items';
import type { paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging } from '../models/paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HiddenOffersService {
    /**
     * Скрытие товаров и настройки скрытия
     * {% include notitle [access](../../_auto/method_scopes/addHiddenOffers.md) %}
     *
     * Скрывает товары магазина на Маркете.
     *
     * {% note info "Данные в каталоге обновляются не мгновенно" %}
     *
     * Это занимает до нескольких минут.
     *
     * {% endnote %}
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
     * @param requestBody Запрос на скрытие оферов.
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Настройки скрытия получены и скоро вступят в силу.
     * @throws ApiError
     */
    public static addHiddenOffers(
        campaignId: number,
        requestBody: {
            /**
             * Список скрытых товаров.
             *
             */
            hiddenOffers: Array<{
                /**
                 * Идентификатор предложения из прайс-листа.
                 *
                 */
                offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
            }>;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/hidden-offers',
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
                423: `К ресурсу нельзя применить указанный метод.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Информация о скрытых вами товарах
     * {% include notitle [access](../../_auto/method_scopes/getHiddenOffers.md) %}
     *
     * Возвращает список скрытых вами товаров для заданного магазина.
     *
     * В списке будут товары, скрытые любым способом — через API, с помощью YML-фида, в кабинете и так далее.
     *
     * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 500 товаров в одном запросе|
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
     * @param offerId Идентификатор скрытого предложения.
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
     * @returns any Информация о скрытых вами товарах.
     * @throws ApiError
     */
    public static getHiddenOffers(
        campaignId: number,
        offerId?: Array<string>,
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<(paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 & {
        /**
         * Список скрытых вами товаров.
         *
         */
        result?: {
            paging?: paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging;
            /**
             * Список скрытых товаров.
             */
            hiddenOffers: Array<paths_1campaigns_1_campaignId_1hidden_offers_post_requestBody_content_application_1json_schema_properties_hiddenOffers_items>;
        };
    })> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/hidden-offers',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'offer_id': offerId,
                'page_token': pageToken,
                'limit': limit,
            },
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
     * Возобновление показа товаров
     * {% include notitle [access](../../_auto/method_scopes/deleteHiddenOffers.md) %}
     *
     * Возобновляет показ скрытых вами товаров магазина на Маркете.
     *
     * {% note info "Данные в каталоге обновляются не мгновенно" %}
     *
     * Это занимает до нескольких минут.
     *
     * {% endnote %}
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
     * @param requestBody Запрос на возобновление показа оферов.
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Показ товаров возобновлен.
     * @throws ApiError
     */
    public static deleteHiddenOffers(
        campaignId: number,
        requestBody: {
            /**
             * Список скрытых товаров.
             *
             */
            hiddenOffers: Array<paths_1campaigns_1_campaignId_1hidden_offers_post_requestBody_content_application_1json_schema_properties_hiddenOffers_items>;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/hidden-offers/delete',
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
                423: `К ресурсу нельзя применить указанный метод.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
}
