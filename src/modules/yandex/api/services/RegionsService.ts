/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging_allOf_0 } from '../models/paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging_allOf_0';
import type { paths_1campaigns_1_campaignId_1settings_get_responses_200_content_application_1json_schema_properties_settings_properties_localRegion_properties_type } from '../models/paths_1campaigns_1_campaignId_1settings_get_responses_200_content_application_1json_schema_properties_settings_properties_localRegion_properties_type';
import type { paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager } from '../models/paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager';
import type { paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions } from '../models/paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions';
import type { paths_1regions_get_responses_200_content_application_1json_schema } from '../models/paths_1regions_get_responses_200_content_application_1json_schema';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RegionsService {
    /**
     * Поиск регионов по их имени
     * {% include notitle [access](../../_auto/method_scopes/searchRegionsByName.md) %}
     *
     * Возвращает информацию о регионе, удовлетворяющем заданным в запросе условиям поиска.
     *
     * Если найдено несколько регионов, удовлетворяющих условиям поиска, возвращается информация по каждому найденному региону (но не более десяти регионов) для возможности определения нужного региона по родительским регионам.
     *
     * Для методов `GET regions`, `GET regions/{regionId}` и `GET regions/{regionId}/children` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество регионов, информация о которых запрошена при помощи этих методов (не более 100 000 регионов).
     *
     * Объем запросов к ресурсу, который возможно выполнить в течение суток, зависит от суммарного количества регионов.
     *
     * |**⚙️ Лимит:** 50 000 запросов в час|
     * |-|
     *
     * @param name Название региона.
     *
     * Важно учитывать регистр: первая буква должна быть заглавной, остальные — строчными. Например, `Москва`.
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
     * @returns any Список найденных регионов.
     * @throws ApiError
     */
    public static searchRegionsByName(
        name: string,
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<{
        /**
         * Регион доставки.
         */
        regions: Array<paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions>;
        /**
         * Идентификатор следующей страницы.
         */
        paging?: paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging_allOf_0;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/regions',
            query: {
                'name': name,
                'page_token': pageToken,
                'limit': limit,
            },
            errors: {
                401: `В запросе не указаны данные для авторизации.`,
                403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
                420: `Превышено ограничение на доступ к ресурсу.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Информация о регионе
     * {% include notitle [access](../../_auto/method_scopes/searchRegionsById.md) %}
     *
     * Возвращает информацию о регионе.
     *
     * Для методов `GET regions`, `GET regions/{regionId}` и `GET regions/{regionId}/children` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество регионов, информация о которых запрошена при помощи этих методов (не более 100 000 регионов).
     *
     * Объем запросов к ресурсу, который возможно выполнить в течение суток, зависит от суммарного количества регионов.
     *
     * |**⚙️ Лимит:** 50 000 запросов в час|
     * |-|
     *
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @returns paths_1regions_get_responses_200_content_application_1json_schema Найденный регион.
     * @throws ApiError
     */
    public static searchRegionsById(
        regionId: number,
    ): CancelablePromise<paths_1regions_get_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/regions/{regionId}',
            path: {
                'regionId': regionId,
            },
            errors: {
                401: `В запросе не указаны данные для авторизации.`,
                403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
                404: `Запрашиваемый ресурс не найден.`,
                420: `Превышено ограничение на доступ к ресурсу.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Информация о дочерних регионах
     * {% include notitle [access](../../_auto/method_scopes/searchRegionChildren.md) %}
     *
     * Возвращает информацию о регионах, являющихся дочерними по отношению к региону, идентификатор которого указан в запросе.
     *
     * Для методов `GET regions`, `GET regions/{regionId}` и `GET regions/{regionId}/children` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество регионов, информация о которых запрошена при помощи этих методов (не более 100 000 регионов).
     *
     * Объем запросов к ресурсу, который возможно выполнить в течение суток, зависит от суммарного количества регионов.
     *
     * |**⚙️ Лимит:** 50 000 запросов в час|
     * |-|
     *
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param page {% note warning "Если в методе есть `page_token`" %}
     *
     * Используйте его вместо параметра `page`.
     *
     * [Подробнее о типах пагинации и их использовании](../../concepts/pagination.md)
     *
     * {% endnote %}
     *
     * Номер страницы результатов.
     *
     * Используется вместе с параметром `page_size`.
     *
     * `page_number` игнорируется, если задан `page_token` или `limit`.
     *
     * @param pageSize Размер страницы.
     *
     * Используется вместе с параметром `page_number`.
     *
     * `page_size` игнорируется, если задан `page_token` или `limit`.
     *
     * @returns any Регионы, являющиеся дочерними к указанному в запросе.
     * @throws ApiError
     */
    public static searchRegionChildren(
        regionId: number,
        page: number = 1,
        pageSize?: number,
    ): CancelablePromise<{
        pager?: paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager;
        /**
         * Регион доставки.
         */
        regions?: {
            /**
             * Идентификатор региона.
             */
            id: number;
            /**
             * Название региона.
             */
            name: string;
            /**
             * Тип региона.
             */
            type: paths_1campaigns_1_campaignId_1settings_get_responses_200_content_application_1json_schema_properties_settings_properties_localRegion_properties_type;
            /**
             * Информация о родительском регионе.
             *
             * Указываются родительские регионы до уровня страны.
             *
             */
            parent?: paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions;
            /**
             * Дочерние регионы.
             */
            children?: Array<paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions> | null;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/regions/{regionId}/children',
            path: {
                'regionId': regionId,
            },
            query: {
                'page': page,
                'pageSize': pageSize,
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
     * Список допустимых кодов стран
     * {% include notitle [access](../../_auto/method_scopes/getRegionsCodes.md) %}
     *
     * Возвращает список стран с их кодами в формате ISO 3166-1 alpha-2.
     *
     * Страна производства `countryCode` понадобится при продаже товаров из-за рубежа для бизнеса. [Инструкция](../../step-by-step/business-info.md)
     *
     * |**⚙️ Лимит:** 100 запросов в час|
     * |-|
     *
     * @returns any Список стран с их кодами в формате ISO 3166-1 alpha-2.
     * @throws ApiError
     */
    public static getRegionsCodes(): CancelablePromise<{
        /**
         * Список стран с их кодами в формате ISO 3166-1 alpha-2.
         */
        countries: Array<{
            region: paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions;
            /**
             * Страна производства в формате ISO 3166-1 alpha-2. [Как получить](../../reference/regions/getRegionsCodes.md)
             *
             */
            countryCode: string;
        }>;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/regions/countries',
            errors: {
                401: `В запросе не указаны данные для авторизации.`,
                403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
                404: `Запрашиваемый ресурс не найден.`,
                420: `Превышено ограничение на доступ к ресурсу.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
}
