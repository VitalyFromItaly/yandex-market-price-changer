/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_supplyScheduleDays_items } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_supplyScheduleDays_items';
import type { paths_1campaigns_1_campaignId_1outlets_1_outletId_get_responses_200_content_application_1json_schema_properties_outlet } from '../models/paths_1campaigns_1_campaignId_1outlets_1_outletId_get_responses_200_content_application_1json_schema_properties_outlet';
import type { paths_1campaigns_1_campaignId_1outlets_post_requestBody_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1outlets_post_requestBody_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1outlets_post_requestBody_content_application_1json_schema_allOf_0 } from '../models/paths_1campaigns_1_campaignId_1outlets_post_requestBody_content_application_1json_schema_allOf_0';
import type { paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager } from '../models/paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OutletsService {
    /**
     * Создание точки продаж
     * {% include notitle [access](../../_auto/method_scopes/createOutlet.md) %}
     *
     * Создает точку продаж магазина на Маркете.
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
     * @param requestBody
     * @returns any Информация о созданной точке продаж.
     * @throws ApiError
     */
    public static createOutlet(
        campaignId: number,
        requestBody: {
            /**
             * Название точки продаж.
             *
             */
            name: string;
            /**
             * Тип точки продаж.
             *
             * Возможные значения:
             *
             * * `DEPOT` — пункт выдачи заказов.
             * * `MIXED` — смешанный тип точки продаж (торговый зал и пункт выдачи заказов).
             * * `RETAIL` — розничная точка продаж (торговый зал).
             * * `NOT_DEFINED` — неизвестный тип точки продажи. При определении типа произошла ошибка.
             *
             */
            type: 'DEPOT' | 'MIXED' | 'RETAIL' | 'NOT_DEFINED';
            /**
             * Координаты точки продаж.
             *
             * Формат: долгота, широта. Разделители: запятая и / или пробел. Например, `20.4522144, 54.7104264`.
             *
             * Если параметр не передан, координаты будут определены по значениям параметров, вложенных в `address`.
             *
             */
            coords?: string;
            /**
             * Признак основной точки продаж.
             *
             * Возможные значения:
             *
             * * `false` — неосновная точка продаж.
             * * `true` — основная точка продаж.
             *
             */
            isMain?: boolean;
            /**
             * Идентификатор точки продаж, присвоенный магазином.
             */
            shopOutletCode?: string;
            /**
             * Состояние точки продаж.
             *
             * Возможные значения:
             *
             * * `HIDDEN` — точка продаж выключена.
             * * `VISIBLE` — точка продаж включена.
             * * `UNKNOWN` — неизвестное состояние точки продажи. При определении состояния произошла ошибка.
             *
             */
            visibility?: 'HIDDEN' | 'VISIBLE' | 'UNKNOWN';
            /**
             * Адрес точки продаж.
             *
             */
            address: {
                /**
                 * Идентификатор региона.
                 *
                 * Идентификатор можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
                 *
                 * {% note alert "Типы регионов при создании и редактировании точек продаж" %}
                 *
                 * Указывайте только регионы типов `TOWN` (город), `CITY` (крупный город) и `REPUBLIC_AREA` (район субъекта федерации). Тип региона указан в выходных параметрах `type` запросов [GET regions](../../reference/regions/searchRegionsByName.md) и [GET regions/{regionId}](../../reference/regions/searchRegionsById.md).
                 *
                 * {% endnote %}
                 *
                 */
                regionId: number;
                /**
                 * Улица.
                 */
                street?: string;
                /**
                 * Номер дома.
                 */
                number?: string;
                /**
                 * Номер строения.
                 */
                building?: string;
                /**
                 * Номер владения.
                 */
                estate?: string;
                /**
                 * Номер корпуса.
                 */
                block?: string;
                /**
                 * Дополнительная информация.
                 */
                additional?: string;
                /**
                 * Порядковый номер километра дороги, на котором располагается точка продаж, если отсутствует улица.
                 */
                km?: number;
                /**
                 * {% note warning "В ответах города и населенные пункты возвращаются в параметре `regionId`." %}
                 *
                 *
                 *
                 * {% endnote %}
                 *
                 * @deprecated
                 */
                city?: string;
            };
            /**
             * Номера телефонов точки продаж. Передавайте в формате: `+7 (999) 999-99-99`.
             *
             */
            phones: Array<string>;
            /**
             * Список режимов работы точки продаж.
             *
             */
            workingSchedule: {
                /**
                 * Признак, работает ли точка продаж в дни государственных праздников.
                 *
                 * Возможные значения:
                 *
                 * * `false` — точка продаж не работает в дни государственных праздников.
                 * * `true` — точка продаж работает в дни государственных праздников.
                 *
                 */
                workInHoliday?: boolean;
                /**
                 * Список расписаний работы точки продаж.
                 *
                 */
                scheduleItems: Array<{
                    /**
                     * Точка продаж работает с указанного дня недели.
                     *
                     * Возможные значения:
                     *
                     * * `MONDAY` — понедельник.
                     * * `TUESDAY` — вторник.
                     * * `WEDNESDAY` — среда.
                     * * `THURSDAY` — четверг.
                     * * `FRIDAY` — пятница.
                     * * `SATURDAY` — суббота.
                     * * `SUNDAY` — воскресенье.
                     *
                     */
                    startDay: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_supplyScheduleDays_items;
                    /**
                     * Точка продаж работает до указанного дня недели.
                     *
                     * Возможные значения:
                     *
                     * * `MONDAY` — понедельник.
                     * * `TUESDAY` — вторник.
                     * * `WEDNESDAY` — среда.
                     * * `THURSDAY` — четверг.
                     * * `FRIDAY` — пятница.
                     * * `SATURDAY` — суббота.
                     * * `SUNDAY` — воскресенье.
                     *
                     */
                    endDay: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_supplyScheduleDays_items;
                    /**
                     * Точка продаж работает c указанного часа.
                     *
                     * Формат: `ЧЧ:ММ`.
                     *
                     */
                    startTime: string;
                    /**
                     * Точка продаж работает до указанного часа.
                     *
                     * Формат: `ЧЧ:ММ`.
                     *
                     */
                    endTime: string;
                }>;
            };
            /**
             * Информация об условиях доставки для данной точки продаж.
             *
             * Обязательный параметр, если параметр `type=DEPOT` или `type=MIXED`.
             *
             */
            deliveryRules?: Array<{
                /**
                 * Минимальный срок доставки товаров в точку продаж. Указан в рабочих днях.
                 *
                 * Минимальное значение: `0` — доставка в день заказа.
                 *
                 * Максимальное значение: `60`.
                 *
                 * Допустимые сроки доставки (разница между `minDeliveryDays` и `maxDeliveryDays`) зависят от региона.
                 *
                 * Для доставки по своему региону разница не должна превышать двух дней. Например, если `minDeliveryDays` равно 1, то для `maxDeliveryDays` допускаются значения от 1 до 3.
                 *
                 * Для доставки в другие регионы:
                 *
                 * * Если `minDeliveryDays` до 18 дней, разница не должна превышать четырех дней. Например, если `minDeliveryDays` равно 10, то для `maxDeliveryDays` допускаются значения от 10 до 14.
                 * * Если `minDeliveryDays` больше 18 дней, разница должна быть не больше чем в два раза. Например, если `minDeliveryDays` равно 21, то для `maxDeliveryDays` допускаются значения от 21 до 42.
                 *
                 * Обязательный параметр, если `type="DEPOT"` или `type="MIXED"`.
                 *
                 * Взаимоисключающий с параметром `unspecifiedDeliveryInterval`.
                 *
                 */
                minDeliveryDays?: number;
                /**
                 * Максимальный срок доставки товаров в точку продаж. Указан в рабочих днях.
                 *
                 * Минимальное значение: `0` — доставка в день заказа.
                 *
                 * Максимальное значение: `60`.
                 *
                 * Допустимые сроки доставки (разница между `minDeliveryDays` и `maxDeliveryDays`) зависят от региона.
                 *
                 * Для доставки по своему региону разница не должна превышать двух дней. Например, если `minDeliveryDays` равно 1, то для `maxDeliveryDays` допускаются значения от 1 до 3.
                 *
                 * Для доставки в другие регионы:
                 *
                 * * Если `minDeliveryDays` до 18 дней, разница не должна превышать четырех дней. Например, если `minDeliveryDays` равно 10, то для `maxDeliveryDays` допускаются значения от 10 до 14.
                 * * Если `minDeliveryDays` больше 18 дней, разница должна быть не больше чем в два раза. Например, если `minDeliveryDays` равно 21, то для `maxDeliveryDays` допускаются значения от 21 до 42.
                 *
                 * Обязательный параметр, если `type="DEPOT"` или `type="MIXED"`.
                 *
                 * Взаимоисключающий с параметром `unspecifiedDeliveryInterval`.
                 *
                 */
                maxDeliveryDays?: number;
                /**
                 * Идентификатор службы доставки товаров в точку продаж.
                 *
                 * Информацию о службе доставки можно получить с помощью запроса [GET delivery/services](../../reference/orders/getDeliveryServices.md).
                 *
                 */
                deliveryServiceId?: number;
                /**
                 * Час, до которого покупателю нужно сделать заказ, чтобы он был доставлен в точку продаж в сроки от `minDeliveryDays` до `maxDeliveryDays`.
                 *
                 * Если покупатель оформит заказ после указанного часа, он будет доставлен в сроки от `minDeliveryDays` + 1 рабочий день до `maxDeliveryDays` + 1 рабочий день.
                 *
                 * Значение по умолчанию: `24`.
                 *
                 */
                orderBefore?: number;
                /**
                 * Цена на товар, начиная с которой действует бесплатный самовывоз товара из точки продаж.
                 */
                priceFreePickup?: number;
                /**
                 * Признак доставки товаров в точку продаж на заказ.
                 *
                 * Признак выставлен, если:
                 *
                 * * точный срок доставки в точку продаж заранее неизвестен (например, если магазин собирает несколько заказов для отправки в точку или населенный пункт);
                 * * все товары изготавливаются или поставляются на заказ.
                 *
                 * Возможные значения:
                 * * `true` — товары доставляются в точку продаж на заказ.
                 *
                 * Параметр указывается только со значением `true`.
                 *
                 * Взаимоисключающий с параметрами `minDeliveryDays` и `maxDeliveryDays`.
                 *
                 */
                unspecifiedDeliveryInterval?: boolean;
            }> | null;
            /**
             * Срок хранения заказа в собственном пункте выдачи заказов. Считается в днях.
             */
            storagePeriod?: number;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/outlets',
            path: {
                'campaignId': campaignId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `| **Описание**                       | **Пояснение**                                                                                                                                                               | **Способы решения**                                                                                  |
                |------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
                | **datediff-is-to-big-local**       | При доставке по своему региону разница между максимальным и минимальным сроком доставки не должна превышать двух дней.                                                      | Убедитесь, что разница между \`maxDeliveryDays\` и \`minDeliveryDays\` не превышает двух дней.           |
                | **datediff-is-to-big-remote**      | При доставке в другие регионы разница между максимальным и минимальным сроком доставки не должна превышать четырех дней.                                                    | Убедитесь, что разница между \`maxDeliveryDays\` и \`minDeliveryDays\` не превышает четырех дней.        |
                | **datediff-is-to-big-long-period** | При доставке в другие регионы, где минимальный срок доставки больше 18 дней, разница между максимальным и минимальным сроком доставки не должна превышать минимальный срок. | Убедитесь, что разница между \`maxDeliveryDays\` и \`minDeliveryDays\` не превышает \`minDeliveryDays\`.   |
                `,
                401: `В запросе не указаны данные для авторизации.`,
                403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
                404: `Запрашиваемый ресурс не найден.`,
                420: `Превышено ограничение на доступ к ресурсу.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Информация о нескольких точках продаж
     * {% include notitle [access](../../_auto/method_scopes/getOutlets.md) %}
     *
     * Возвращает список точек продаж магазина.
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
     * @param pageToken Идентификатор страницы c результатами.
     *
     * Если параметр не указан, возвращается первая страница.
     *
     * Рекомендуем передавать значение выходного параметра `nextPageToken`, полученное при последнем запросе.
     *
     * Если задан `page_token` и в запросе есть параметры `page_number` и `page_size`, они игнорируются.
     *
     * @param regionId Идентификатор региона.
     * Если задать идентификатор родительского региона любого уровня, в выходных данных будут отображены точки продаж всех дочерних регионов.
     * Идентификатор региона можно получить c помощью метода [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param shopOutletCode Идентификатор точки продаж, присвоенный магазином.
     * @param regionId {% note warning "Вместо него используйте `region_id`." %}
     *
     *
     *
     * {% endnote %}
     *
     * @returns any Информация о точках продаж.
     * @throws ApiError
     */
    public static getOutlets(
        campaignId: number,
        pageToken?: string,
        regionId?: number,
        shopOutletCode?: string,
        regionId?: number,
    ): CancelablePromise<{
        /**
         * Информация о точках продаж.
         */
        outlets: Array<paths_1campaigns_1_campaignId_1outlets_1_outletId_get_responses_200_content_application_1json_schema_properties_outlet>;
        /**
         * Информация о страницах результатов.
         */
        paging?: {
            /**
             * Идентификатор следующей страницы результатов.
             */
            nextPageToken?: string;
        };
        pager?: paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/outlets',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'page_token': pageToken,
                'region_id': regionId,
                'shop_outlet_code': shopOutletCode,
                'regionId': regionId,
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
     * Изменение информации о точке продаж
     * {% include notitle [access](../../_auto/method_scopes/updateOutlet.md) %}
     *
     * Изменяет информацию о точке продаж магазина на Маркете.
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
     * @param outletId Идентификатор точки продаж.
     * @param requestBody
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static updateOutlet(
        campaignId: number,
        outletId: number,
        requestBody: paths_1campaigns_1_campaignId_1outlets_post_requestBody_content_application_1json_schema,
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/campaigns/{campaignId}/outlets/{outletId}',
            path: {
                'campaignId': campaignId,
                'outletId': outletId,
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
     * Информация об одной точке продаж
     * {% include notitle [access](../../_auto/method_scopes/getOutlet.md) %}
     *
     * Возвращает информацию о точках продаж магазина.
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
     * @param outletId Идентификатор точки продаж.
     * @returns any Информация о точке продаж.
     * @throws ApiError
     */
    public static getOutlet(
        campaignId: number,
        outletId: number,
    ): CancelablePromise<{
        /**
         * Информация о точке продаж.
         */
        outlet?: paths_1campaigns_1_campaignId_1outlets_post_requestBody_content_application_1json_schema_allOf_0;
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/outlets/{outletId}',
            path: {
                'campaignId': campaignId,
                'outletId': outletId,
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
     * Удаление точки продаж
     * {% include notitle [access](../../_auto/method_scopes/deleteOutlet.md) %}
     *
     * Удаляет точку продаж магазина на Маркете.
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
     * @param outletId Идентификатор точки продаж.
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static deleteOutlet(
        campaignId: number,
        outletId: number,
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/campaigns/{campaignId}/outlets/{outletId}',
            path: {
                'campaignId': campaignId,
                'outletId': outletId,
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
