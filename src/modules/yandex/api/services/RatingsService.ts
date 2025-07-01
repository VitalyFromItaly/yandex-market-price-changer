/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class RatingsService {
    /**
     * Индекс качества магазинов
     * {% include notitle [access](../../_auto/method_scopes/getQualityRatings.md) %}
     *
     * Возвращает значение индекса качества магазинов и его составляющие.
     *
     * Подробнее об индексе качества читайте [в Справке Маркета для продавцов](https://yandex.ru/support2/marketplace/ru/quality/score/).
     *
     * |**⚙️ Лимит:** 10 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Значение индекса качества магазинов и его составляющие.
     * @throws ApiError
     */
    public static getQualityRatings(
        businessId: number,
        requestBody: {
            /**
             * Начало периода.
             *
             * Формат даты: `ГГГГ‑ММ‑ДД`.
             *
             * Не может быть раньше 30 дней от текущей даты.
             *
             */
            dateFrom?: string;
            /**
             * Конец периода.
             *
             * Формат даты: `ГГГГ‑ММ‑ДД`.
             *
             * Не может быть позже текущей даты.
             *
             */
            dateTo?: string;
            /**
             * Список идентификаторов кампании.
             *
             * Их можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
             *
             * * **Модули и API** → блок **Передача данных Маркету**.
             * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
             *
             * ⚠️ Не используйте вместо них идентификаторы магазинов, которые указаны в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
             *
             */
            campaignIds: Array<number>;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/ratings/quality',
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
     * Заказы, которые повлияли на индекс качества
     * {% include notitle [access](../../_auto/method_scopes/getQualityRatingDetails.md) %}
     *
     * Возвращает список заказов, которые повлияли на индекс качества магазина. Чтобы узнать значение индекса качества, выполните запрос [POST businesses/{businessId}/ratings/quality](../../reference/ratings/getQualityRatings.md).
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
     * @returns any Информация о заказах, которые повлияли на индекс качества.
     * @throws ApiError
     */
    public static getQualityRatingDetails(
        campaignId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/ratings/quality/details',
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
