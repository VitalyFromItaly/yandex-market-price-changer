/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1models_1offers_post_responses_200_content_application_1json_schema } from '../models/paths_1models_1offers_post_responses_200_content_application_1json_schema';
import type { paths_1models_get_parameters_2_schema } from '../models/paths_1models_get_parameters_2_schema';
import type { paths_1models_post_requestBody_content_application_1json_schema } from '../models/paths_1models_post_requestBody_content_application_1json_schema';
import type { paths_1models_post_responses_200_content_application_1json_schema } from '../models/paths_1models_post_responses_200_content_application_1json_schema';
import type { paths_1models_post_responses_200_content_application_1json_schema_allOf_0_properties_models_items } from '../models/paths_1models_post_responses_200_content_application_1json_schema_allOf_0_properties_models_items';
import type { paths_1models_post_responses_200_content_application_1json_schema_allOf_1 } from '../models/paths_1models_post_responses_200_content_application_1json_schema_allOf_1';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ModelsService {
    /**
     * @deprecated
     * Информация о нескольких моделях
     * {% include notitle [access](../../_auto/method_scopes/getModels.md) %}
     *
     * Возвращает информацию о моделях товаров.
     *
     * В одном запросе можно получить информацию не более чем о 100 моделях.
     *
     * Для методов `GET models`, `GET models/{modelId}` и `POST models` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество моделей, информация о которых запрошена при помощи этих методов.
     *
     * |**⚙️ Лимит:** 100 000 моделей в час|
     * |-|
     *
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param requestBody
     * @param currency Валюта, в которой отображаются цены предложений на страницах с результатами поиска.
     *
     * Возможные значения:
     *
     * * `BYN` — белорусский рубль.
     *
     * * `KZT` — казахстанский тенге.
     *
     * * `RUR` — российский рубль.
     *
     * * `UAH` — украинская гривна.
     *
     * Значение по умолчанию: используется национальная валюта магазина (национальная валюта страны происхождения магазина).
     *
     * @returns any Информация о моделях.
     * @throws ApiError
     */
    public static getModels(
        regionId: number,
        requestBody: {
            /**
             * Список моделей.
             */
            models: Array<number>;
        },
        currency?: 'RUR' | 'USD' | 'EUR' | 'UAH' | 'AUD' | 'GBP' | 'BYR' | 'BYN' | 'DKK' | 'ISK' | 'KZT' | 'CAD' | 'CNY' | 'NOK' | 'XDR' | 'SGD' | 'TRY' | 'SEK' | 'CHF' | 'JPY' | 'AZN' | 'ALL' | 'DZD' | 'AOA' | 'ARS' | 'AMD' | 'AFN' | 'BHD' | 'BGN' | 'BOB' | 'BWP' | 'BND' | 'BRL' | 'BIF' | 'HUF' | 'VEF' | 'KPW' | 'VND' | 'GMD' | 'GHS' | 'GNF' | 'HKD' | 'GEL' | 'AED' | 'EGP' | 'ZMK' | 'ILS' | 'INR' | 'IDR' | 'JOD' | 'IQD' | 'IRR' | 'YER' | 'QAR' | 'KES' | 'KGS' | 'COP' | 'CDF' | 'CRC' | 'KWD' | 'CUP' | 'LAK' | 'LVL' | 'SLL' | 'LBP' | 'LYD' | 'SZL' | 'LTL' | 'MUR' | 'MRO' | 'MKD' | 'MWK' | 'MGA' | 'MYR' | 'MAD' | 'MXN' | 'MZN' | 'MDL' | 'MNT' | 'NPR' | 'NGN' | 'NIO' | 'NZD' | 'OMR' | 'PKR' | 'PYG' | 'PEN' | 'PLN' | 'KHR' | 'SAR' | 'RON' | 'SCR' | 'SYP' | 'SKK' | 'SOS' | 'SDG' | 'SRD' | 'TJS' | 'THB' | 'TWD' | 'BDT' | 'TZS' | 'TND' | 'TMM' | 'UGX' | 'UZS' | 'UYU' | 'PHP' | 'DJF' | 'XAF' | 'XOF' | 'HRK' | 'CZK' | 'CLP' | 'LKR' | 'EEK' | 'ETB' | 'RSD' | 'ZAR' | 'KRW' | 'NAD' | 'TL' | 'UE',
    ): CancelablePromise<({
        /**
         * Список моделей товаров.
         */
        models: Array<{
            /**
             * Идентификатор модели товара.
             */
            id?: number;
            /**
             * Название модели товара.
             */
            name?: string;
            /**
             * Информация о ценах на модель товара.
             */
            prices?: {
                /**
                 * Средняя цена предложения для модели в регионе.
                 */
                avg?: number;
                /**
                 * Максимальная цена предложения для модели в регионе.
                 */
                max?: number;
                /**
                 * Минимальная цена предложения для модели в регионе.
                 */
                min?: number;
            };
        }>;
    } & {
        currency?: paths_1models_get_parameters_2_schema;
        /**
         * Идентификатор региона, для которого выводится информация о предложениях модели (доставляемых в этот регион).
         *
         * Информацию о регионе по идентификатору можно получить с помощью запроса [GET regions/{regionId}](../../reference/regions/searchRegionsById.md).
         *
         */
        regionId?: number;
    })> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/models',
            query: {
                'regionId': regionId,
                'currency': currency,
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
     * @deprecated
     * Поиск модели товара
     * {% include notitle [access](../../_auto/method_scopes/searchModels.md) %}
     *
     * Возвращает информацию о моделях, удовлетворяющих заданным в запросе условиям поиска.
     *
     * В одном запросе можно получить информацию не более чем о 100 моделях.
     *
     * Для методов `GET models`, `GET models/{modelId}` и `POST models` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество моделей, информация о которых запрошена при помощи этих методов.
     *
     * |**⚙️ Лимит:** 100 000 моделей в час|
     * |-|
     *
     * @param query Поисковый запрос по названию модели товара.
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param currency Валюта, в которой отображаются цены предложений на страницах с результатами поиска.
     *
     * Возможные значения:
     *
     * * `BYN` — белорусский рубль.
     *
     * * `KZT` — казахстанский тенге.
     *
     * * `RUR` — российский рубль.
     *
     * * `UAH` — украинская гривна.
     *
     * Значение по умолчанию: используется национальная валюта магазина (национальная валюта страны происхождения магазина).
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
     * @returns any Информация о моделях.
     * @throws ApiError
     */
    public static searchModels(
        query: string,
        regionId: number,
        currency?: 'RUR' | 'USD' | 'EUR' | 'UAH' | 'AUD' | 'GBP' | 'BYR' | 'BYN' | 'DKK' | 'ISK' | 'KZT' | 'CAD' | 'CNY' | 'NOK' | 'XDR' | 'SGD' | 'TRY' | 'SEK' | 'CHF' | 'JPY' | 'AZN' | 'ALL' | 'DZD' | 'AOA' | 'ARS' | 'AMD' | 'AFN' | 'BHD' | 'BGN' | 'BOB' | 'BWP' | 'BND' | 'BRL' | 'BIF' | 'HUF' | 'VEF' | 'KPW' | 'VND' | 'GMD' | 'GHS' | 'GNF' | 'HKD' | 'GEL' | 'AED' | 'EGP' | 'ZMK' | 'ILS' | 'INR' | 'IDR' | 'JOD' | 'IQD' | 'IRR' | 'YER' | 'QAR' | 'KES' | 'KGS' | 'COP' | 'CDF' | 'CRC' | 'KWD' | 'CUP' | 'LAK' | 'LVL' | 'SLL' | 'LBP' | 'LYD' | 'SZL' | 'LTL' | 'MUR' | 'MRO' | 'MKD' | 'MWK' | 'MGA' | 'MYR' | 'MAD' | 'MXN' | 'MZN' | 'MDL' | 'MNT' | 'NPR' | 'NGN' | 'NIO' | 'NZD' | 'OMR' | 'PKR' | 'PYG' | 'PEN' | 'PLN' | 'KHR' | 'SAR' | 'RON' | 'SCR' | 'SYP' | 'SKK' | 'SOS' | 'SDG' | 'SRD' | 'TJS' | 'THB' | 'TWD' | 'BDT' | 'TZS' | 'TND' | 'TMM' | 'UGX' | 'UZS' | 'UYU' | 'PHP' | 'DJF' | 'XAF' | 'XOF' | 'HRK' | 'CZK' | 'CLP' | 'LKR' | 'EEK' | 'ETB' | 'RSD' | 'ZAR' | 'KRW' | 'NAD' | 'TL' | 'UE',
        page: number = 1,
        pageSize?: number,
    ): CancelablePromise<paths_1models_post_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/models',
            query: {
                'query': query,
                'regionId': regionId,
                'currency': currency,
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
     * @deprecated
     * Информация об одной модели
     * {% include notitle [access](../../_auto/method_scopes/getModel.md) %}
     *
     * Возвращает информацию о модели товара.
     *
     * Для методов `GET models`, `GET models/{modelId}` и `POST models` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество моделей, информация о которых запрошена при помощи этих методов.
     *
     * |**⚙️ Лимит:** 100 000 моделей в час|
     * |-|
     *
     * @param modelId Идентификатор модели товара.
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param currency Валюта, в которой отображаются цены предложений на страницах с результатами поиска.
     *
     * Возможные значения:
     *
     * * `BYN` — белорусский рубль.
     *
     * * `KZT` — казахстанский тенге.
     *
     * * `RUR` — российский рубль.
     *
     * * `UAH` — украинская гривна.
     *
     * Значение по умолчанию: используется национальная валюта магазина (национальная валюта страны происхождения магазина).
     *
     * @returns paths_1models_post_responses_200_content_application_1json_schema Информация о модели.
     * @throws ApiError
     */
    public static getModel(
        modelId: number,
        regionId: number,
        currency?: 'RUR' | 'USD' | 'EUR' | 'UAH' | 'AUD' | 'GBP' | 'BYR' | 'BYN' | 'DKK' | 'ISK' | 'KZT' | 'CAD' | 'CNY' | 'NOK' | 'XDR' | 'SGD' | 'TRY' | 'SEK' | 'CHF' | 'JPY' | 'AZN' | 'ALL' | 'DZD' | 'AOA' | 'ARS' | 'AMD' | 'AFN' | 'BHD' | 'BGN' | 'BOB' | 'BWP' | 'BND' | 'BRL' | 'BIF' | 'HUF' | 'VEF' | 'KPW' | 'VND' | 'GMD' | 'GHS' | 'GNF' | 'HKD' | 'GEL' | 'AED' | 'EGP' | 'ZMK' | 'ILS' | 'INR' | 'IDR' | 'JOD' | 'IQD' | 'IRR' | 'YER' | 'QAR' | 'KES' | 'KGS' | 'COP' | 'CDF' | 'CRC' | 'KWD' | 'CUP' | 'LAK' | 'LVL' | 'SLL' | 'LBP' | 'LYD' | 'SZL' | 'LTL' | 'MUR' | 'MRO' | 'MKD' | 'MWK' | 'MGA' | 'MYR' | 'MAD' | 'MXN' | 'MZN' | 'MDL' | 'MNT' | 'NPR' | 'NGN' | 'NIO' | 'NZD' | 'OMR' | 'PKR' | 'PYG' | 'PEN' | 'PLN' | 'KHR' | 'SAR' | 'RON' | 'SCR' | 'SYP' | 'SKK' | 'SOS' | 'SDG' | 'SRD' | 'TJS' | 'THB' | 'TWD' | 'BDT' | 'TZS' | 'TND' | 'TMM' | 'UGX' | 'UZS' | 'UYU' | 'PHP' | 'DJF' | 'XAF' | 'XOF' | 'HRK' | 'CZK' | 'CLP' | 'LKR' | 'EEK' | 'ETB' | 'RSD' | 'ZAR' | 'KRW' | 'NAD' | 'TL' | 'UE',
    ): CancelablePromise<paths_1models_post_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/models/{modelId}',
            path: {
                'modelId': modelId,
            },
            query: {
                'regionId': regionId,
                'currency': currency,
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
     * Список предложений для нескольких моделей
     * {% include notitle [access](../../_auto/method_scopes/getModelsOffers.md) %}
     *
     * Возвращает информацию о первых десяти предложениях, расположенных на карточках моделей, идентификаторы которых указаны в запросе.
     *
     * Предложения выдаются для определенного региона и располагаются в том же порядке, в котором они показываются в выдаче Маркета на карточке модели.
     *
     * Для групповых моделей выдача предложений не поддерживается. Идентификаторы групповых моделей игнорируются.
     *
     * В одном запросе можно получить информацию о предложениях не более чем для 100 моделей.
     *
     * Для методов `GET models/{modelId}/offers` и `POST models/offers` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество моделей, информация о которых запрошена при помощи этих методов.
     *
     * |**⚙️ Лимит:** 100 000 предложений в час|
     * |-|
     *
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param requestBody
     * @param currency Валюта, в которой отображаются цены предложений на страницах с результатами поиска.
     *
     * Возможные значения:
     *
     * * `BYN` — белорусский рубль.
     *
     * * `KZT` — казахстанский тенге.
     *
     * * `RUR` — российский рубль.
     *
     * * `UAH` — украинская гривна.
     *
     * Значение по умолчанию: используется национальная валюта магазина (национальная валюта страны происхождения магазина).
     *
     * @param orderByPrice Направление сортировки по цене.
     *
     * Возможные значения:
     * * `ASC` — сортировка по возрастанию.
     * * `DESC` — сортировка по убыванию.
     *
     * Значение по умолчанию: предложения выводятся в произвольном порядке.
     *
     * @returns any Список предложений для моделей.
     * @throws ApiError
     */
    public static getModelsOffers(
        regionId: number,
        requestBody: paths_1models_post_requestBody_content_application_1json_schema,
        currency?: 'RUR' | 'USD' | 'EUR' | 'UAH' | 'AUD' | 'GBP' | 'BYR' | 'BYN' | 'DKK' | 'ISK' | 'KZT' | 'CAD' | 'CNY' | 'NOK' | 'XDR' | 'SGD' | 'TRY' | 'SEK' | 'CHF' | 'JPY' | 'AZN' | 'ALL' | 'DZD' | 'AOA' | 'ARS' | 'AMD' | 'AFN' | 'BHD' | 'BGN' | 'BOB' | 'BWP' | 'BND' | 'BRL' | 'BIF' | 'HUF' | 'VEF' | 'KPW' | 'VND' | 'GMD' | 'GHS' | 'GNF' | 'HKD' | 'GEL' | 'AED' | 'EGP' | 'ZMK' | 'ILS' | 'INR' | 'IDR' | 'JOD' | 'IQD' | 'IRR' | 'YER' | 'QAR' | 'KES' | 'KGS' | 'COP' | 'CDF' | 'CRC' | 'KWD' | 'CUP' | 'LAK' | 'LVL' | 'SLL' | 'LBP' | 'LYD' | 'SZL' | 'LTL' | 'MUR' | 'MRO' | 'MKD' | 'MWK' | 'MGA' | 'MYR' | 'MAD' | 'MXN' | 'MZN' | 'MDL' | 'MNT' | 'NPR' | 'NGN' | 'NIO' | 'NZD' | 'OMR' | 'PKR' | 'PYG' | 'PEN' | 'PLN' | 'KHR' | 'SAR' | 'RON' | 'SCR' | 'SYP' | 'SKK' | 'SOS' | 'SDG' | 'SRD' | 'TJS' | 'THB' | 'TWD' | 'BDT' | 'TZS' | 'TND' | 'TMM' | 'UGX' | 'UZS' | 'UYU' | 'PHP' | 'DJF' | 'XAF' | 'XOF' | 'HRK' | 'CZK' | 'CLP' | 'LKR' | 'EEK' | 'ETB' | 'RSD' | 'ZAR' | 'KRW' | 'NAD' | 'TL' | 'UE',
        orderByPrice?: 'ASC' | 'DESC',
    ): CancelablePromise<({
        /**
         * Список моделей товаров.
         */
        models: Array<paths_1models_post_responses_200_content_application_1json_schema_allOf_0_properties_models_items>;
    } & paths_1models_post_responses_200_content_application_1json_schema_allOf_1)> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/models/offers',
            query: {
                'regionId': regionId,
                'currency': currency,
                'orderByPrice': orderByPrice,
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
     * @deprecated
     * Список предложений для одной модели
     * {% include notitle [access](../../_auto/method_scopes/getModelOffers.md) %}
     *
     * Возвращает информацию о первых десяти предложениях, расположенных на карточке модели.
     *
     * Предложения выдаются для определенного региона и располагаются в том же порядке, в котором они показываются в выдаче Маркета на карточке модели.
     *
     * Для групповых моделей метод не поддерживается. Идентификатор групповой модели игнорируется.
     *
     * Для методов `GET models/{modelId}/offers` и `POST models/offers` действует групповое ресурсное ограничение. Ограничение вводится на суммарное количество моделей, информация о которых запрошена при помощи этих методов.
     *
     * |**⚙️ Лимит:** 100 000 предложений в час|
     * |-|
     *
     * @param modelId Идентификатор модели товара.
     * @param regionId Идентификатор региона.
     *
     * Идентификатор региона можно получить c помощью запроса [GET regions](../../reference/regions/searchRegionsByName.md).
     *
     * @param currency Валюта, в которой отображаются цены предложений на страницах с результатами поиска.
     *
     * Возможные значения:
     *
     * * `BYN` — белорусский рубль.
     *
     * * `KZT` — казахстанский тенге.
     *
     * * `RUR` — российский рубль.
     *
     * * `UAH` — украинская гривна.
     *
     * Значение по умолчанию: используется национальная валюта магазина (национальная валюта страны происхождения магазина).
     *
     * @param orderByPrice Направление сортировки по цене.
     *
     * Возможные значения:
     * * `ASC` — сортировка по возрастанию.
     * * `DESC` — сортировка по убыванию.
     *
     * Значение по умолчанию: предложения выводятся в произвольном порядке.
     *
     * @param count Количество предложений на странице ответа.
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
     * @returns paths_1models_1offers_post_responses_200_content_application_1json_schema Список предложений для модели.
     * @throws ApiError
     */
    public static getModelOffers(
        modelId: number,
        regionId: number,
        currency?: 'RUR' | 'USD' | 'EUR' | 'UAH' | 'AUD' | 'GBP' | 'BYR' | 'BYN' | 'DKK' | 'ISK' | 'KZT' | 'CAD' | 'CNY' | 'NOK' | 'XDR' | 'SGD' | 'TRY' | 'SEK' | 'CHF' | 'JPY' | 'AZN' | 'ALL' | 'DZD' | 'AOA' | 'ARS' | 'AMD' | 'AFN' | 'BHD' | 'BGN' | 'BOB' | 'BWP' | 'BND' | 'BRL' | 'BIF' | 'HUF' | 'VEF' | 'KPW' | 'VND' | 'GMD' | 'GHS' | 'GNF' | 'HKD' | 'GEL' | 'AED' | 'EGP' | 'ZMK' | 'ILS' | 'INR' | 'IDR' | 'JOD' | 'IQD' | 'IRR' | 'YER' | 'QAR' | 'KES' | 'KGS' | 'COP' | 'CDF' | 'CRC' | 'KWD' | 'CUP' | 'LAK' | 'LVL' | 'SLL' | 'LBP' | 'LYD' | 'SZL' | 'LTL' | 'MUR' | 'MRO' | 'MKD' | 'MWK' | 'MGA' | 'MYR' | 'MAD' | 'MXN' | 'MZN' | 'MDL' | 'MNT' | 'NPR' | 'NGN' | 'NIO' | 'NZD' | 'OMR' | 'PKR' | 'PYG' | 'PEN' | 'PLN' | 'KHR' | 'SAR' | 'RON' | 'SCR' | 'SYP' | 'SKK' | 'SOS' | 'SDG' | 'SRD' | 'TJS' | 'THB' | 'TWD' | 'BDT' | 'TZS' | 'TND' | 'TMM' | 'UGX' | 'UZS' | 'UYU' | 'PHP' | 'DJF' | 'XAF' | 'XOF' | 'HRK' | 'CZK' | 'CLP' | 'LKR' | 'EEK' | 'ETB' | 'RSD' | 'ZAR' | 'KRW' | 'NAD' | 'TL' | 'UE',
        orderByPrice?: 'ASC' | 'DESC',
        count: number = 10,
        page: number = 1,
    ): CancelablePromise<paths_1models_1offers_post_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/models/{modelId}/offers',
            path: {
                'modelId': modelId,
            },
            query: {
                'regionId': regionId,
                'currency': currency,
                'orderByPrice': orderByPrice,
                'count': count,
                'page': page,
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
