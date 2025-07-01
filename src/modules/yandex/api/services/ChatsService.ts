/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ChatsService {
    /**
     * Создание нового чата с покупателем
     * {% include notitle [access](../../_auto/method_scopes/createChat.md) %}
     *
     * Создает новый чат с покупателем.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody description
     * @returns any Все получилось: чат создан.
     *
     * @throws ApiError
     */
    public static createChat(
        businessId: number,
        requestBody: {
            /**
             * Идентификатор заказа на Маркете.
             */
            orderId?: number;
        },
    ): CancelablePromise<(paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 & {
        /**
         * Информация о созданном чате.
         */
        result?: {
            /**
             * Идентификатор чата.
             */
            chatId: number;
        };
    })> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/chats/new',
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
     * Получение доступных чатов
     * {% include notitle [access](../../_auto/method_scopes/getChats.md) %}
     *
     * Возвращает чаты с покупателями.
     *
     * {% note tip "Подключите API-уведомления" %}
     *
     * Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда появится новый чат или сообщение.
     *
     * [{#T}](../../push-notifications/index.md)
     *
     * {% endnote %}
     *
     * |**⚙️ Лимит:** 10 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody description
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
     * @returns any Список чатов.
     *
     * @throws ApiError
     */
    public static getChats(
        businessId: number,
        requestBody: {
            /**
             * Фильтр по идентификаторам заказов на Маркете.
             */
            orderIds?: Array<number> | null;
            /**
             * Фильтр по типам чатов.
             */
            types?: Array<'CHAT' | 'ARBITRAGE'> | null;
            /**
             * Фильтр по статусам чатов.
             */
            statuses?: Array<'NEW' | 'WAITING_FOR_CUSTOMER' | 'WAITING_FOR_PARTNER' | 'WAITING_FOR_ARBITER' | 'WAITING_FOR_MARKET' | 'FINISHED'> | null;
        },
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/chats',
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
     * Получение чата по идентификатору
     * {% include notitle [access](../../_auto/method_scopes/getChat.md) %}
     *
     * Возвращает чат по его идентификатору.
     *
     * {% note tip "Подключите API-уведомления" %}
     *
     * Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда появится новый чат или сообщение.
     *
     * [{#T}](../../push-notifications/index.md)
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
     * @param chatId Идентификатор чата.
     * @returns any Информация о чате.
     *
     * @throws ApiError
     */
    public static getChat(
        businessId: number,
        chatId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/businesses/{businessId}/chat',
            path: {
                'businessId': businessId,
            },
            query: {
                'chatId': chatId,
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
     * Отправка файла в чат
     * {% include notitle [access](../../_auto/method_scopes/sendFileToChat.md) %}
     *
     * Отправляет файл в чат с покупателем.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param chatId Идентификатор чата.
     * @param formData description
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ. Означает, что файл отправлен.
     * @throws ApiError
     */
    public static sendFileToChat(
        businessId: number,
        chatId: number,
        formData: {
            /**
             * Содержимое файла. Максимальный размер файла — 5 Мбайт.
             */
            file: Blob;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/chats/file/send',
            path: {
                'businessId': businessId,
            },
            query: {
                'chatId': chatId,
            },
            formData: formData,
            mediaType: 'multipart/form-data',
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
     * Отправка сообщения в чат
     * {% include notitle [access](../../_auto/method_scopes/sendMessageToChat.md) %}
     *
     * Отправляет сообщение в чат с покупателем.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param chatId Идентификатор чата.
     * @param requestBody description
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ. Означает, что сообщение отправлено.
     * @throws ApiError
     */
    public static sendMessageToChat(
        businessId: number,
        chatId: number,
        requestBody: {
            /**
             * Текст сообщения.
             */
            message: string;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/chats/message',
            path: {
                'businessId': businessId,
            },
            query: {
                'chatId': chatId,
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
     * Получение сообщения в чате
     * {% include notitle [access](../../_auto/method_scopes/getChatMessage.md) %}
     *
     * Возвращает сообщение по его идентификатору.
     *
     * {% note tip "Подключите API-уведомления" %}
     *
     * Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда появится новый чат или сообщение.
     *
     * [{#T}](../../push-notifications/index.md)
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
     * @param chatId Идентификатор чата.
     * @param messageId Идентификатор сообщения.
     * @returns any Сообщение и информация о нем.
     *
     * @throws ApiError
     */
    public static getChatMessage(
        businessId: number,
        chatId: number,
        messageId: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/businesses/{businessId}/chats/message',
            path: {
                'businessId': businessId,
            },
            query: {
                'chatId': chatId,
                'messageId': messageId,
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
     * Получение истории сообщений в чате
     * {% include notitle [access](../../_auto/method_scopes/getChatHistory.md) %}
     *
     * Возвращает историю сообщений в чате с покупателем.
     *
     * |**⚙️ Лимит:** 10 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param chatId Идентификатор чата.
     * @param requestBody description
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
     * @returns any История сообщений успешно получена.
     *
     * @throws ApiError
     */
    public static getChatHistory(
        businessId: number,
        chatId: number,
        requestBody: {
            /**
             * Идентификатор сообщения, начиная с которого нужно получить все последующие сообщения.
             */
            messageIdFrom?: number;
        },
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/chats/history',
            path: {
                'businessId': businessId,
            },
            query: {
                'chatId': chatId,
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
}
