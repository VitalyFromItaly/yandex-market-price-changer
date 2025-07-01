/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate';
import type { paths_1campaigns_1_campaignId_get_responses_200_content_application_1json_schema_properties_campaign } from '../models/paths_1campaigns_1_campaignId_get_responses_200_content_application_1json_schema_properties_campaign';
import type { paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions } from '../models/paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions';
import type { paths_1reports_1united_netting_1generate_post_requestBody_content_application_1json_schema_properties_placementPrograms_items } from '../models/paths_1reports_1united_netting_1generate_post_requestBody_content_application_1json_schema_properties_placementPrograms_items';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CampaignsService {
    /**
     * Список магазинов пользователя
     * {% include notitle [access](../../_auto/method_scopes/getCampaigns.md) %}
     *
     * **Для Api-Key-токена:** возвращает список магазинов в кабинете, для которого выдан токен. Нельзя получить список только подагентских магазинов.
     *
     * **Для OAuth-токена:** возвращает список магазинов, к которым имеет доступ пользователь — владелец авторизационного токена, использованного в запросе. Для агентских пользователей список состоит из подагентских магазинов.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
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
     * @returns any Магазины пользователя.
     * @throws ApiError
     */
    public static getCampaigns(
        page: number = 1,
        pageSize?: number,
    ): CancelablePromise<{
        /**
         * Список с информацией по каждому магазину.
         */
        campaigns: Array<paths_1campaigns_1_campaignId_get_responses_200_content_application_1json_schema_properties_campaign>;
        /**
         * Модель для пагинации.
         */
        pager?: {
            /**
             * Сколько всего найдено элементов.
             */
            total?: number;
            /**
             * Начальный номер найденного элемента на странице.
             */
            from?: number;
            /**
             * Конечный номер найденного элемента на странице.
             */
            to?: number;
            /**
             * Текущая страница.
             */
            currentPage?: number;
            /**
             * Общее количество страниц.
             */
            pagesCount?: number;
            /**
             * Размер страницы.
             */
            pageSize?: number;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns',
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
     * Информация о магазине
     * {% include notitle [access](../../_auto/method_scopes/getCampaign.md) %}
     *
     * Возвращает информацию о магазине.
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
     * @returns any Информация о магазине.
     * @throws ApiError
     */
    public static getCampaign(
        campaignId: number,
    ): CancelablePromise<{
        /**
         * Информация о магазине.
         */
        campaign?: {
            /**
             * URL магазина.
             */
            domain?: string;
            /**
             * Идентификатор кампании.
             *
             * Его также можно найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
             *
             * * **Модули и API** → блок **Передача данных Маркету**.
             * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
             *
             * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
             *
             */
            id?: number;
            /**
             * Идентификатор плательщика в Яндекс Балансе.
             */
            clientId?: number;
            /**
             * Информация о кабинете.
             */
            business?: {
                /**
                 * Идентификатор кабинета.
                 */
                id?: number;
                /**
                 * Название бизнеса.
                 */
                name?: string;
            };
            placementType?: paths_1reports_1united_netting_1generate_post_requestBody_content_application_1json_schema_properties_placementPrograms_items;
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}',
            path: {
                'campaignId': campaignId,
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
     * Настройки магазина
     * {% include notitle [access](../../_auto/method_scopes/getCampaignSettings.md) %}
     *
     * Возвращает информацию о настройках магазина, идентификатор которого указан в запросе.
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
     * @returns any Настройки магазина.
     * @throws ApiError
     */
    public static getCampaignSettings(
        campaignId: number,
    ): CancelablePromise<{
        /**
         * Настройки магазина.
         */
        settings?: {
            /**
             * Идентификатор региона, в котором находится магазин.
             */
            countryRegion?: number;
            /**
             * Наименование магазина на Яндекс Маркете.
             * Если наименование отсутствует, значение параметра выводится — `null`.
             *
             */
            shopName?: string;
            /**
             * Признак размещения магазина на сайтах партнеров Яндекс Дистрибуции.
             * Возможные значения:
             * * `false` — магазин не размещен на сайтах партнеров Яндекс Дистрибуции.
             * * `true` — магазин размещен на сайтах партнеров Яндекс Дистрибуции.
             *
             */
            showInContext?: boolean;
            /**
             * Признак показа предложений магазина в блоке над результатами поиска (cпецразмещение).
             * Возможные значения:
             * * `false` — предложения не показываются в блоке cпецразмещения.
             * * `true` — предложения показываются в блоке cпецразмещения.
             *
             */
            showInPremium?: boolean;
            /**
             * Признак использования внешней интернет-статистики.
             * Возможные значения:
             * * `false` — внешняя интернет-статистика не используется.
             * * `true` — внешняя интернет-статистика используется.
             *
             */
            useOpenStat?: boolean;
            /**
             * Информация о своем регионе магазина.
             */
            localRegion?: {
                /**
                 * Идентификатор региона.
                 */
                id?: number;
                /**
                 * Название региона.
                 */
                name?: string;
                /**
                 * Тип региона.
                 *
                 * Возможные значения:
                 *
                 * * `CITY_DISTRICT` — район города.
                 *
                 * * `CITY` — крупный город.
                 *
                 * * `CONTINENT` — континент.
                 *
                 * * `COUNTRY_DISTRICT` — область.
                 *
                 * * `COUNTRY` — страна.
                 *
                 * * `REGION` — регион.
                 *
                 * * `REPUBLIC_AREA` — район субъекта федерации.
                 *
                 * * `REPUBLIC` — субъект федерации.
                 *
                 * * `SUBWAY_STATION` — станция метро.
                 *
                 * * `VILLAGE` — город.
                 *
                 * * `OTHER` — неизвестный регион.
                 *
                 */
                type?: 'OTHER' | 'CONTINENT' | 'REGION' | 'COUNTRY' | 'COUNTRY_DISTRICT' | 'REPUBLIC' | 'CITY' | 'VILLAGE' | 'CITY_DISTRICT' | 'SUBWAY_STATION' | 'REPUBLIC_AREA';
                /**
                 * Источник информации о расписании работы службы доставки.
                 * Возможные значения:
                 * * `WEB` — информация получена из настроек кабинета продавца на Маркете.
                 * * `YML` — информация получена из прайс-листа магазина.
                 *
                 */
                deliveryOptionsSource?: 'WEB' | 'YML';
                /**
                 * Информация о доставке в своем регионе магазина.
                 */
                delivery?: {
                    /**
                     * Расписание работы службы доставки в своем регионе.
                     */
                    schedule?: {
                        /**
                         * Признак работы службы доставки в государственные праздники.
                         * Возможные значения.
                         * * `false` — служба доставки не работает в праздничные дни.
                         * * `true` — служба доставки работает в праздничные дни.
                         *
                         */
                        availableOnHolidays?: boolean;
                        /**
                         * Список дней, в которые служба доставки не работает. Дни магазин указал в кабинете продавца на Маркете.
                         */
                        customHolidays: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate>;
                        /**
                         * Список выходных и праздничных дней, в которые служба доставки работает. Дни магазин указал в кабинете продавца на Маркете.
                         */
                        customWorkingDays: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate>;
                        /**
                         * Период, за который рассчитывается итоговый список нерабочих дней службы доставки.
                         */
                        period?: {
                            /**
                             * Дата (включительно) начала периода, по которому рассчитан итоговый список нерабочих дней службы доставки.
                             *
                             * Формат даты: `ДД-ММ-ГГГГ`.
                             *
                             */
                            fromDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
                            /**
                             * Дата (включительно) окончания периода, по которому рассчитан итоговый список нерабочих дней службы доставки.
                             *
                             * Формат даты: `ДД-ММ-ГГГГ`.
                             *
                             */
                            toDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
                        };
                        /**
                         * Итоговый список нерабочих дней службы доставки. Список рассчитывается с учетом выходных, нерабочих дней и государственных праздников. Информацию по ним магазин указывает в кабинете продавца на Маркете.
                         */
                        totalHolidays: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate>;
                        /**
                         * Список выходных дней недели и государственных праздников.
                         */
                        weeklyHolidays: Array<number>;
                    };
                };
            };
        };
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/settings',
            path: {
                'campaignId': campaignId,
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
     * @deprecated
     * Регион магазина
     * {% include notitle [access](../../_auto/method_scopes/getCampaignRegion.md) %}
     *
     * {% note warning "Какой метод использовать вместо устаревшего" %}
     *
     * [GET campaigns/{campaignId}/settings](../../reference/campaigns/getCampaignSettings.md)
     *
     * {% endnote %}
     *
     * Возвращает регион, в котором находится магазин.
     * |**⚙️ Лимит:** 5 000 запросов в час|
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
     * @returns any Возвращает регион, в котором находится магазин.
     *
     * @throws ApiError
     */
    public static getCampaignRegion(
        campaignId: number,
    ): CancelablePromise<{
        region?: paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/region',
            path: {
                'campaignId': campaignId,
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
