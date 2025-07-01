/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ShipmentsService {
    /**
     * Подтверждение ближайшей отгрузки и получение акта приема-передачи для нее
     * {% include notitle [access](../../_auto/method_scopes/downloadShipmentReceptionTransferAct.md) %}
     *
     * Запрос подтверждает ближайшую отгрузку и возвращает акт приема-передачи в формате PDF.
     *
     * {% note warning "Экспресс‑доставка" %}
     *
     * Если ваш магазин подключен к экспресс‑доставке и вы отгружаете заказы курьерам [Яндекс Go](https://go.yandex/), подготавливать акт приема‑передачи не нужно.
     *
     * {% endnote %}
     *
     * В акт входят собранные и готовые к отправке заказы, которые отгружаются в сортировочный центр или пункт приема или курьерам Маркета.
     *
     * При формировании акта Маркет автоматически находит и подставляет в шаблон следующие данные:
     *
     * {% cut "Данные, из которых Маркет формирует акт" %}
     *
     * #|
     * || **Данные в акте**                                     | **Описание**                                                                                                                                                                                                                                                         ||
     * || Отправитель                                           | Название вашего юридического лица, указанное в кабинете продавца на Маркете.                                                                                                                                                                                         ||
     * || Исполнитель                                         | Название юридического лица сортировочного центра или службы доставки.                                                                                                                                                                                                ||
     * || № отправления в системе заказчика                   |
     * {% note warning "Поле больше не используется" %}
     *
     *
     *
     * {% endnote %}
     *
     * Ваш идентификатор заказа, который вы указали в ответе на запрос `POST order/accept` от Маркета.                                                                                                                                                                      ||
     * || № отправления в системе исполнителя (субподрядчика) | Идентификатор заказа на Маркете, как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md).                                                                                                                             ||
     * || Объявленная ценность                                | Общая сумма заказа без учета стоимости доставки, как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).                       ||
     * || Стоимость всех товаров в заказе                     | Стоимость всех заказанных товаров.                                                                                                                                                                                                                                   ||
     * || Вес                                                 | Масса брутто грузового места (суммарная масса упаковки и содержимого), как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md). ||
     * || Количество мест                                     | Количество грузовых мест в заказе, как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).                                     ||
     * |#
     *
     * {% endcut %}
     *
     * Остальные поля нужно заполнить самостоятельно в распечатанном акте.
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
     * @param warehouseId Идентификатор склада.
     * @param signatory Логин пользователя в Яндекс ID, от имени которого будет подписываться электронный акт приема-передачи.
     *
     * Указывается без `@yandex.ru`.
     *
     * Где его найти:
     *
     * * на странице [Яндекс ID](https://id.yandex.ru);
     * * в [кабинете продавца на Маркете](https://partner.market.yandex.ru/):
     *
     * * слева снизу под иконкой пользователя;
     * * на странице **Настройки** → **Сотрудники и доступы**.
     *
     * @returns binary Акт приема-передачи в формате PDF.
     * @throws ApiError
     */
    public static downloadShipmentReceptionTransferAct(
        campaignId: number,
        warehouseId?: number,
        signatory?: string,
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/shipments/reception-transfer-act',
            path: {
                'campaignId': campaignId,
            },
            query: {
                'warehouse_id': warehouseId,
                'signatory': signatory,
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
     * Получение информации об одной отгрузке
     * {% include notitle [access](../../_auto/method_scopes/getShipment.md) %}
     *
     * Возвращает информацию об отгрузке по ее идентификатору.
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
     * @param shipmentId Идентификатор отгрузки.
     * @param cancelledOrders Возвращать ли отмененные заказы.
     *
     * Значение по умолчанию: `true`. Если возвращать отмененные заказы не нужно, передайте значение `false`.
     *
     * @returns any Найденная отгрузка.
     * @throws ApiError
     */
    public static getShipment(
        campaignId: number,
        shipmentId: number,
        cancelledOrders: boolean = true,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
            },
            query: {
                'cancelledOrders': cancelledOrders,
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
     * Получение информации о возможности печати ярлыков
     * {% include notitle [access](../../_auto/method_scopes/getShipmentOrdersInfo.md) %}
     *
     * Возвращает информацию о возможности печати ярлыков-наклеек для заказов в отгрузке.
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
     * @param shipmentId Идентификатор отгрузки.
     * @returns any Информация по годным/негодным для печати ярлыков заказам в отгрузке.
     * @throws ApiError
     */
    public static getShipmentOrdersInfo(
        campaignId: number,
        shipmentId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/orders/info',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Подтверждение отгрузки
     * {% include notitle [access](../../_auto/method_scopes/confirmShipment.md) %}
     *
     * Подтверждает отгрузку товаров в сортировочный центр или пункт приема заказов.
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
     * @param shipmentId Идентификатор отгрузки.
     * @param requestBody
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static confirmShipment(
        campaignId: number,
        shipmentId: number,
        requestBody?: {
            /**
             * Идентификатор отгрузки в системе поставщика.
             */
            externalShipmentId?: string;
            /**
             * Логин пользователя в Яндекс ID, от имени которого будет подписываться электронный акт приема-передачи.
             *
             * Указывается без `@yandex.ru`.
             *
             * Где его найти:
             *
             * * на странице [Яндекс ID](https://id.yandex.ru);
             * * в [кабинете продавца на Маркете](https://partner.market.yandex.ru/):
             *
             * * слева снизу под иконкой пользователя;
             * * на странице **Настройки** → **Сотрудники и доступы**.
             *
             */
            signatory?: string;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/confirm',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Получение акта приема-передачи
     * {% include notitle [access](../../_auto/method_scopes/downloadShipmentAct.md) %}
     *
     * {% note warning "Экспресс‑доставка" %}
     *
     * Если ваш магазин подключен к экспресс‑доставке и вы отгружаете заказы курьерам Яндекс Go, подготавливать акт приема‑передачи не нужно.
     *
     * {% endnote %}
     *
     * Запрос формирует акт приема-передачи заказов, входящих в отгрузку, и возвращает акт в формате PDF. В акте содержатся собранные и готовые к отправке заказы.
     *
     * При формировании акта Маркет автоматически находит и подставляет в шаблон следующие данные:
     *
     * {% cut "Данные, из которых Маркет формирует акт" %}
     *
     * #|
     * || **Данные в акте**                                         | **Описание**                                                                                                                                                                                                                                                         ||
     * || Дата                                                      | Дата запроса.                                                                                                                                                                                                                                                        ||
     * || Отправитель                                               | Название вашего юридического лица, указанное в кабинете продавца на Маркете.                                                                                                                                                                                         ||
     * || Исполнитель                                               | Название юридического лица сортировочного центра или службы доставки.                                                                                                                                                                                                ||
     * || № отправления в системе заказчика                         |
     * {% note warning "Поле больше не используется" %}
     *
     *
     *
     * {% endnote %}
     *
     * Ваш идентификатор заказа, который вы указали в ответе на запрос `POST order/accept` от Маркета.                                                                                                                                                                      ||
     * || № отправления в системе исполнителя (субподрядчика)       | Идентификатор заказа на Маркете, как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md).                                                                                                                             ||
     * || Объявленная ценность                                      | Общая сумма заказа без учета стоимости доставки, как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).                       ||
     * || Вес                                                       | Масса брутто грузового места (суммарная масса упаковки и содержимого), как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md). ||
     * || Количество мест                                           | Количество грузовых мест в заказе, как в выходных данных запроса [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).                                     ||
     * |#
     *
     * {% endcut %}
     *
     * Остальные поля нужно заполнить самостоятельно в распечатанном акте.
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
     * @param shipmentId Идентификатор отгрузки.
     * @returns binary Акт приема-передачи для отгрузки в формате PDF.
     * @throws ApiError
     */
    public static downloadShipmentAct(
        campaignId: number,
        shipmentId: number,
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/act',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Получение фактического акта приема-передачи
     * {% include notitle [access](../../_auto/method_scopes/downloadShipmentInboundAct.md) %}
     *
     * Возвращает фактический акт приема-передачи для заданной отгрузки.
     *
     * Такой акт становится доступен спустя несколько часов после завершения отгрузки. Он может понадобиться, если после отгрузки обнаружатся расхождения.
     *
     * |**⚙️ Лимит:** 200 запросов в час|
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
     * @param shipmentId Идентификатор отгрузки.
     * @returns binary Акт в формате PDF.
     * @throws ApiError
     */
    public static downloadShipmentInboundAct(
        campaignId: number,
        shipmentId: number,
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/inbound-act',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Получение транспортной накладной
     * {% include notitle [access](../../_auto/method_scopes/downloadShipmentTransportationWaybill.md) %}
     *
     * Возвращает транспортную накладную для заданной отгрузки.
     *
     * Транспортная накладная понадобится, если вы отгружаете товары непосредственно со своего склада. [Подробно об этом способе отгрузки](https://yandex.ru/support/marketplace/orders/fbs/settings/shipment.html#at-your-warehouse)
     *
     * |**⚙️ Лимит:** 200 запросов в час|
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
     * @param shipmentId Идентификатор отгрузки.
     * @returns binary Транспортная накладная в формате XLSX.
     * @throws ApiError
     */
    public static downloadShipmentTransportationWaybill(
        campaignId: number,
        shipmentId: number,
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/transportation-waybill',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Получение акта расхождений
     * {% include notitle [access](../../_auto/method_scopes/downloadShipmentDiscrepancyAct.md) %}
     *
     * Возвращает акт расхождений для заданной отгрузки.
     * |**⚙️ Лимит:** 200 запросов в час|
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
     * @param shipmentId Идентификатор отгрузки.
     * @returns binary Акт расхождений в формате XLSX.
     * @throws ApiError
     */
    public static downloadShipmentDiscrepancyAct(
        campaignId: number,
        shipmentId: number,
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/discrepancy-act',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Передача количества упаковок в отгрузке
     * {% include notitle [access](../../_auto/method_scopes/setShipmentPalletsCount.md) %}
     *
     * Передает Маркету количество коробов или палет в отгрузке для доверительной приемки. Подробнее про доверительную приемку написано в [Справке Маркета](https://yandex.ru/support/marketplace/orders/fbs/process.html#acceptance).
     *
     * Получить PDF-файл с ярлыками для упаковок можно с помощью запроса [GET campaigns/{campaignId}/first-mile/shipments/{shipmentId}/pallet/labels](../../reference/shipments/downloadShipmentPalletLabels.md).
     * |**⚙️ Лимит:** 200 запросов в час|
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
     * @param shipmentId Идентификатор отгрузки.
     * @param requestBody
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Имеет значение только тип ответа. Если ответ `ОК`, количество упаковок записано.
     * @throws ApiError
     */
    public static setShipmentPalletsCount(
        campaignId: number,
        shipmentId: number,
        requestBody: {
            /**
             * Количество упаковок в отгрузке.
             */
            placesCount: number;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/pallets',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
     * Ярлыки для доверительной приемки
     * {% include notitle [access](../../_auto/method_scopes/downloadShipmentPalletLabels.md) %}
     *
     * PDF-файл с ярлыками на каждый короб или палету в отгрузке для доверительной приемки. Подробнее про доверительную приемку написано в [Справке Маркета](https://yandex.ru/support/marketplace/orders/fbs/process.html#acceptance).
     *
     * Распечатайте по несколько копий каждого ярлыка: на одну тару нужно наклеить минимум 2 ярлыка с разных сторон.
     *
     * Количество упаковок в отгрузке задается в запросе [PUT campaigns/{campaignId}/first-mile/shipments/{shipmentId}/pallets](../../reference/shipments/setShipmentPalletsCount.md).
     * |**⚙️ Лимит:** 200 запросов в час|
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
     * @param shipmentId Идентификатор отгрузки.
     * @param format Формат страниц PDF-файла с ярлыками:
     *
     * * `A4` — по 16 ярлыков на странице.
     * * `A8` — по одному ярлыку на странице.
     *
     * @returns binary PDF‑файл с ярлыками на все упаковки в отгрузке.
     * @throws ApiError
     */
    public static downloadShipmentPalletLabels(
        campaignId: number,
        shipmentId: number,
        format: 'A4' | 'A8' = 'A8',
    ): CancelablePromise<Blob> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/pallet/labels',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
            },
            query: {
                'format': format,
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
     * Получение информации о нескольких отгрузках
     * {% include notitle [access](../../_auto/method_scopes/searchShipments.md) %}
     *
     * Возвращает информацию об отгрузках по заданным параметрам:
     *
     * * дате;
     * * статусу;
     * * идентификаторам заказов.
     *
     * Результаты возвращаются постранично.
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
     * @returns any Найденные отгрузки.
     * @throws ApiError
     */
    public static searchShipments(
        campaignId: number,
        requestBody: {
            /**
             * Начальная дата для фильтрации по дате отгрузки (включительно).
             *
             * Формат даты: `ДД-ММ-ГГГГ`.
             *
             */
            dateFrom: string;
            /**
             * Конечная дата для фильтрации по дате отгрузки (включительно).
             *
             * Формат даты: `ДД-ММ-ГГГГ`.
             *
             */
            dateTo: string;
            /**
             * Список статусов отгрузок.
             */
            statuses?: Array<'OUTBOUND_CREATED' | 'OUTBOUND_READY_FOR_CONFIRMATION' | 'OUTBOUND_CONFIRMED' | 'OUTBOUND_SIGNED' | 'FINISHED' | 'ACCEPTED' | 'ACCEPTED_WITH_DISCREPANCIES' | 'ERROR'> | null;
            /**
             * Список идентификаторов заказов из отгрузок.
             */
            orderIds?: Array<number> | null;
            /**
             * Возвращать ли отмененные заказы.
             *
             * Значение по умолчанию: `true`. Если возвращать отмененные заказы не нужно, передайте значение `false`.
             *
             */
            cancelledOrders?: boolean;
        },
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/campaigns/{campaignId}/first-mile/shipments',
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
     * Перенос заказов в следующую отгрузку
     * {% include notitle [access](../../_auto/method_scopes/transferOrdersFromShipment.md) %}
     *
     * Переносит указанные заказы из указанной отгрузки в следующую отгрузку. [Что такое отгрузка?](https://yandex.ru/support/marketplace/orders/fbs/process.html#ship)
     *
     * Используйте этот запрос, если не успеваете собрать и упаковать заказы вовремя.
     *
     * {% note warning "Такие переносы снижают индекс качества магазина" %}
     *
     * Этот запрос предназначен для исключительных случаев. Если вы будете переносить заказы слишком часто, магазин столкнется с ограничениями. [Что за ограничения?](https://yandex.ru/support/marketplace/quality/score/fbs.html)
     *
     * {% endnote %}
     *
     * Переносить заказы можно, если до формирования отгрузки осталось больше получаса.
     *
     * Перенос происходит не мгновенно, а занимает несколько минут.
     *
     * |**⚙️ Лимит:** 200 запросов в час|
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
     * @param shipmentId Идентификатор отгрузки.
     * @param requestBody
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Запрос на перенос заказов проверен и принят, и они будут перенесены спустя несколько минут.
     * @throws ApiError
     */
    public static transferOrdersFromShipment(
        campaignId: number,
        shipmentId: number,
        requestBody: {
            /**
             * Список заказов, которые вы не успеваете подготовить.
             */
            orderIds: Array<number>;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/campaigns/{campaignId}/first-mile/shipments/{shipmentId}/orders/transfer',
            path: {
                'campaignId': campaignId,
                'shipmentId': shipmentId,
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
