/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OutletLicensesService {
    /**
     * Информация о лицензиях для точек продаж
     * {% include notitle [access](../../_auto/method_scopes/getOutletLicenses.md) %}
     *
     * Возвращает информацию о лицензиях для точек продаж.
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
     * @param outletIds Список идентификаторов точек продаж, для которых нужно получить информацию о лицензиях. Идентификаторы указываются через запятую.
     *
     * В запросе должен быть либо параметр `outletIds`, либо параметр `ids`. Запрос с обоими параметрами или без них приведет к ошибке.
     *
     * @param ids Список идентификаторов лицензий, информацию о которых нужно получить.
     *
     * Идентификаторы указываются через запятую. Идентификатор лицензии присваивается Маркетом. Не путайте его с номером, указанным на лицензии.
     *
     * В запросе должен быть либо параметр `outletIds`, либо параметр `ids`. Запрос с обоими параметрами или без них приведет к ошибке.
     *
     * @returns any Найденные лицензии собственных точек продаж.
     * @throws ApiError
     */
    public static getOutletLicenses(
        campaignId: number,
        outletIds?: Array<number>,
        ids?: Array<number>,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/outlets/licenses',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'outletIds': outletIds,
                'ids': ids,
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
     * Удаление лицензий для точек продаж
     * {% include notitle [access](../../_auto/method_scopes/deleteOutletLicenses.md) %}
     *
     * Удаляет информацию о лицензиях для точек продаж.
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
     * @param ids Список идентификаторов лицензий, информацию о которых нужно удалить.
     *
     * Идентификаторы указываются через запятую. Идентификатор лицензии присваивается Маркетом. Не путайте его с номером, указанным на лицензии.
     *
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static deleteOutletLicenses(
        campaignId: number,
        ids: Array<number>,
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/campaigns/{campaignId}/outlets/licenses',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'ids': ids,
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
     * Создание и изменение лицензий для точек продаж
     * {% include notitle [access](../../_auto/method_scopes/updateOutletLicenses.md) %}
     *
     * Передает информацию о новых и существующих лицензиях для точек продаж. Поддерживаются только лицензии на розничную продажу алкоголя.
     *
     * Чтобы размещать алкогольную продукцию на Маркете, надо также прислать гарантийное письмо (если вы еще не делали этого раньше) и правильно оформить предложения в прайс-листе. Далее информация о лицензиях проходит проверку.
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
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static updateOutletLicenses(
        campaignId: number,
        requestBody: {
            /**
             * Список лицензий.
             * Обязательный параметр, должен содержать информацию хотя бы об одной лицензии.
             *
             */
            licenses: Array<{
                /**
                 * Идентификатор лицензии.
                 *
                 * Параметр указывается, только если нужно изменить информацию о существующей лицензии. Ее идентификатор можно узнать с помощью запроса [GET campaigns/{campaignId}/outlets/licenses](../../reference/outlets/getOutletLicenses.md). При передаче информации о новой лицензии указывать идентификатор не нужно.
                 *
                 * Идентификатор лицензии присваивается Маркетом. Не путайте его с номером, указанным на лицензии: он передается в параметре `number`.
                 *
                 */
                id?: number;
                /**
                 * Идентификатор точки продаж, для которой действительна лицензия.
                 */
                outletId: number;
                /**
                 * Тип лицензии:
                 *
                 * * `ALCOHOL` — лицензия на розничную продажу алкогольной продукции.
                 * * `UNKNOWN` — неизвестный тип лицензии.
                 *
                 */
                licenseType: 'ALCOHOL' | 'UNKNOWN';
                /**
                 * Номер лицензии.
                 */
                number: string;
                /**
                 * Дата выдачи лицензии.
                 *
                 * Формат даты: ISO 8601 со смещением относительно UTC. Нужно передать дату, указанную на лицензии, время `00:00:00` и часовой пояс, соответствующий региону точки продаж. Например, если лицензия для точки продаж в Москве выдана 13 ноября 2017 года, то параметр должен иметь значение `2017-11-13T00:00:00+03:00`.
                 *
                 * Не может быть позже даты окончания срока действия, указанной в параметре `dateOfExpiry`.
                 *
                 */
                dateOfIssue: string;
                /**
                 * Дата окончания действия лицензии.
                 *
                 * Формат даты: ISO 8601 со смещением относительно UTC. Нужно передать дату, указанную на лицензии, время `00:00:00` и часовой пояс, соответствующий региону точки продаж. Например, если действие лицензии для точки продаж в Москве заканчивается 20 ноября 2022 года, то параметр должен иметь значение `2022-11-20T00:00:00+03:00`.
                 *
                 * Не может быть раньше даты выдачи, указанной в параметре `dateOfIssue`.
                 *
                 */
                dateOfExpiry: string;
            }>;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/outlets/licenses',
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
