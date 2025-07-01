/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1businesses_1_businessId_1promos_post_responses_200_content_application_1json_schema_allOf_1_properties_result_properties_promos_items_properties_mechanicsInfo_properties_type } from '../models/paths_1businesses_1_businessId_1promos_post_responses_200_content_application_1json_schema_allOf_1_properties_result_properties_promos_items_properties_mechanicsInfo_properties_type';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PromosService {
    /**
     * Получение списка акций
     * {% include notitle [access](../../_auto/method_scopes/getPromos.md) %}
     *
     * Возвращает информацию об акциях Маркета.
     *
     * По умолчанию возвращаются акции, в которых продавец участвует или может принять участие.
     *
     * Чтобы получить текущие или завершенные акции, передайте параметр `participation`.
     *
     * Типы акций, которые возвращаются в ответе:
     *
     * * прямая скидка;
     * * флеш-акция;
     * * скидка по промокоду.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Список акций Маркета.
     * @throws ApiError
     */
    public static getPromos(
        businessId: number,
        requestBody?: {
            /**
             * Какие акции вернутся:
             *
             * * `PARTICIPATING_NOW` — текущие и будущие акции продавца.
             *
             * * `PARTICIPATED` — завершенные акции продавца за последний год. Если за год их было меньше 15, в ответе придут 15 последних акций за все время.
             *
             */
            participation?: 'PARTICIPATING_NOW' | 'PARTICIPATED';
            /**
             * Фильтр по типу акции.
             *
             * По умолчанию возвращаются все типы акций.
             *
             */
            mechanics?: paths_1businesses_1_businessId_1promos_post_responses_200_content_application_1json_schema_allOf_1_properties_result_properties_promos_items_properties_mechanicsInfo_properties_type;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/promos',
            path: {
                'businessId': businessId,
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
     * Получение списка товаров, которые участвуют или могут участвовать в акции
     * {% include notitle [access](../../_auto/method_scopes/getPromoOffers.md) %}
     *
     * Возвращает список товаров, которые участвуют или могут участвовать в акции.
     *
     * {% note warning "Условия участия в акциях могут меняться" %}
     *
     * Например, `maxPromoPrice`.
     *
     * Установленные цены меняться не будут — `price` и `promoPrice`.
     *
     * {% endnote %}
     *
     * |**⚙️ Лимит:** 10 000 запросов в час, не более 500 товаров в запросе|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
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
     * @returns any Список товаров, которые участвуют или могут участвовать в акции.
     * @throws ApiError
     */
    public static getPromoOffers(
        businessId: number,
        requestBody: {
            /**
             * Идентификатор акции.
             */
            promoId: string;
            /**
             * {% note warning "Вместо него используйте `statuses`." %}
             *
             *
             *
             * {% endnote %}
             *
             * Фильтр для товаров, которые добавлены в акцию вручную.
             *
             * Если не передать параметр `statusType`, вернутся все товары.
             *
             * @deprecated
             */
            statusType?: 'MANUALLY_ADDED' | 'NOT_MANUALLY_ADDED';
            /**
             * Фильтр для товаров, которые могут участвовать в акции. Можно задать несколько значений.
             */
            statuses?: Array<'MANUALLY_ADDED' | 'RENEWED' | 'RENEW_FAILED' | 'NOT_MANUALLY_ADDED' | 'MINIMUM_FOR_PROMOS'> | null;
        },
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/promos/offers',
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
                404: `Запрашиваемый ресурс не найден.`,
                420: `Превышено ограничение на доступ к ресурсу.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Добавление товаров в акцию или изменение их цен
     * {% include notitle [access](../../_auto/method_scopes/updatePromoOffers.md) %}
     *
     * Добавляет товары в акцию или изменяет цены на товары, которые участвуют в акции.
     *
     * Изменения начинают действовать в течение 4–6 часов.
     *
     * |**⚙️ Лимит:** 10 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Результат добавления товаров в акцию или обновления их цен.
     * @throws ApiError
     */
    public static updatePromoOffers(
        businessId: number,
        requestBody: {
            /**
             * Идентификатор акции.
             */
            promoId: string;
            /**
             * Товары, которые необходимо добавить в акцию или цены которых нужно изменить.
             */
            offers: Array<{
                offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
                /**
                 * Параметры товара, который участвует в акции.
                 */
                params?: {
                    /**
                     * Параметры товара в акции с типом `DIRECT_DISCOUNT` или `BLUE_FLASH`.
                     *
                     * Обязательный параметр для акций с этими типами.
                     *
                     */
                    discountParams?: {
                        /**
                         * Зачеркнутая цена — та, по которой товар продавался до акции.
                         *
                         * Указывается в рублях.
                         *
                         * Число должно быть целым.
                         *
                         */
                        price?: number;
                        /**
                         * Цена по акции — та, по которой вы хотите продавать товар.
                         *
                         * Указывается в рублях.
                         *
                         * Число должно быть целым.
                         *
                         */
                        promoPrice?: number;
                    };
                };
            }>;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/promos/offers/update',
            path: {
                'businessId': businessId,
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
     * Удаление товаров из акции
     * {% include notitle [access](../../_auto/method_scopes/deletePromoOffers.md) %}
     *
     * Убирает товары из акции.
     *
     * Изменения начинают действовать в течение 4–6 часов.
     *
     * |**⚙️ Лимит:** 10 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Результат удаления товаров из акции.
     * @throws ApiError
     */
    public static deletePromoOffers(
        businessId: number,
        requestBody: {
            /**
             * Идентификатор акции.
             */
            promoId: string;
            /**
             * Чтобы убрать все товары из акции и больше не участвовать в ней, передайте значение `true` и не передавайте параметр `offerIds`.
             */
            deleteAllOffers?: boolean;
            /**
             * Товары, которые нужно убрать из акции.
             */
            offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/promos/offers/delete',
            path: {
                'businessId': businessId,
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
