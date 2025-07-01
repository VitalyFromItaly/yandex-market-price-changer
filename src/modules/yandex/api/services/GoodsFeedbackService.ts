/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1businesses_1_businessId_1goods_feedback_1comments_1delete_post_requestBody_content_application_1json_schema_properties_id } from '../models/paths_1businesses_1_businessId_1goods_feedback_1comments_1delete_post_requestBody_content_application_1json_schema_properties_id';
import type { paths_1businesses_1_businessId_1goods_feedback_1comments_post_requestBody_content_application_1json_schema_properties_feedbackId } from '../models/paths_1businesses_1_businessId_1goods_feedback_1comments_post_requestBody_content_application_1json_schema_properties_feedbackId';
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class GoodsFeedbackService {
    /**
     * Получение отзывов о товарах продавца
     * {% include notitle [access](../../_auto/method_scopes/getGoodsFeedbacks.md) %}
     *
     * Возвращает отзывы о товарах продавца по указанным фильтрам. **Исключение:** отзывы, которые удалили покупатели или Маркет.
     *
     * {% note tip "Вы также можете настроить API-уведомления" %}
     *
     * Маркет отправит вам [запрос](../../push-notifications/reference/sendNotification.md), когда появится новый отзыв. А полную информацию о нем можно получить с помощью этого метода.
     *
     * [{#T}](../../push-notifications/index.md)
     *
     * {% endnote %}
     *
     * Результаты возвращаются постранично, одна страница содержит не более 50 отзывов.
     *
     * Отзывы расположены в порядке публикации, поэтому вы можете передавать определенный идентификатор страницы в `page_token`, если вы получали его ранее.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
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
     * @param requestBody
     * @returns any Список отзывов.
     * @throws ApiError
     */
    public static getGoodsFeedbacks(
        businessId: number,
        pageToken?: string,
        limit?: number,
        requestBody?: {
            /**
             * Идентификаторы отзывов.
             *
             * ⚠️ Не используйте это поле одновременно с другими фильтрами. Если вы хотите воспользоваться ими, оставьте поле пустым.
             *
             */
            feedbackIds?: Array<paths_1businesses_1_businessId_1goods_feedback_1comments_post_requestBody_content_application_1json_schema_properties_feedbackId> | null;
            /**
             * Начало периода. Не включительно.
             *
             * Если параметр не указан, возвращается информация за 6 месяцев до указанной в `dateTimeTo` даты.
             *
             */
            dateTimeFrom?: string;
            /**
             * Конец периода. Не включительно.
             *
             * Если параметр не указан, используется текущая дата.
             *
             */
            dateTimeTo?: string;
            /**
             * Нужно ли вернуть только непрочитанные отзывы. Для этого передайте значение `NEED_REACTION`.
             *
             * По умолчанию возвращаются все отзывы.
             *
             */
            reactionStatus?: 'ALL' | 'NEED_REACTION';
            /**
             * Оценка товара.
             */
            ratingValues?: Array<number> | null;
            /**
             * Фильтр по идентификатору модели товара.
             *
             * Получить идентификатор модели можно с помощью одного из запросов:
             *
             * * [POST businesses/{businessId}/offer-mappings](../../reference/business-assortment/getOfferMappings.md);
             *
             * * [POST businesses/{businessId}/offer-cards](../../reference/content/getOfferCardsContentStatus.md).
             *
             * @deprecated
             */
            modelIds?: Array<number> | null;
            /**
             * Фильтр отзывов за баллы Плюса.
             */
            paid?: boolean;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/goods-feedback',
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
     * Пропуск реакции на отзывы
     * {% include notitle [access](../../_auto/method_scopes/skipGoodsFeedbacksReaction.md) %}
     *
     * Пропускает реакцию на отзыв — параметр `needReaction` принимает значение `false` в методе получения всех отзывов [POST businesses/{businessId}/goods-feedback](../../reference/goods-feedback/getGoodsFeedbacks.md).
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static skipGoodsFeedbacksReaction(
        businessId: number,
        requestBody: {
            /**
             * Список идентификаторов отзывов, на которые магазин не будет отвечать.
             */
            feedbackIds: Array<paths_1businesses_1_businessId_1goods_feedback_1comments_post_requestBody_content_application_1json_schema_properties_feedbackId>;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/goods-feedback/skip-reaction',
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
     * Добавление нового или изменение созданного комментария
     * {% include notitle [access](../../_auto/method_scopes/updateGoodsFeedbackComment.md) %}
     *
     * Добавляет новый комментарий магазина или изменяет комментарий, который магазин оставлял ранее.
     *
     * Для создания комментария к отзыву передайте только идентификатор отзыва `feedbackId`.
     *
     * Чтобы добавить комментарий к другому комментарию, передайте:
     *
     * * `feedbackId` — идентификатор отзыва;
     * * `comment.parentId` — идентификатор родительского комментария.
     *
     * Чтобы изменить комментарий, передайте:
     *
     * * `feedbackId`— идентификатор отзыва;
     * * `comment.id` — идентификатор комментария, который нужно изменить.
     *
     * Если передать одновременно `comment.parentId` и `comment.id`, будет изменен существующий комментарий.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Информация о добавленном или измененном комментарии.
     * @throws ApiError
     */
    public static updateGoodsFeedbackComment(
        businessId: number,
        requestBody: {
            feedbackId: paths_1businesses_1_businessId_1goods_feedback_1comments_post_requestBody_content_application_1json_schema_properties_feedbackId;
            /**
             * Параметры комментария.
             */
            comment: {
                /**
                 * Идентификатор комментария, который нужно изменить.
                 *
                 * Оставьте поле пустым, если хотите добавить новый комментарий.
                 *
                 */
                id?: paths_1businesses_1_businessId_1goods_feedback_1comments_1delete_post_requestBody_content_application_1json_schema_properties_id;
                /**
                 * Идентификатор родительского комментария, на который нужно ответить.
                 */
                parentId?: paths_1businesses_1_businessId_1goods_feedback_1comments_1delete_post_requestBody_content_application_1json_schema_properties_id;
                /**
                 * Текст комментария.
                 */
                text: string;
            };
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/goods-feedback/comments/update',
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
     * Удаление комментария к отзыву
     * {% include notitle [access](../../_auto/method_scopes/deleteGoodsFeedbackComment.md) %}
     *
     * Удаляет комментарий магазина.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
     * @throws ApiError
     */
    public static deleteGoodsFeedbackComment(
        businessId: number,
        requestBody: {
            /**
             * Идентификатор комментария к отзыву.
             *
             */
            id: number;
        },
    ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/goods-feedback/comments/delete',
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
     * Получение комментариев к отзыву
     * {% include notitle [access](../../_auto/method_scopes/getGoodsFeedbackComments.md) %}
     *
     * Возвращает комментарии к отзыву, кроме:
     *
     * * тех, которые удалили пользователи или Маркет;
     * * комментариев к удаленным отзывам.
     *
     * {% note tip "Вы также можете настроить API-уведомления" %}
     *
     * Маркет отправит вам [запрос](../../push-notifications/reference/sendNotification.md), когда появится новый комментарий. А полную информацию о нем можно получить с помощью этого метода.
     *
     * [{#T}](../../push-notifications/index.md)
     *
     * {% endnote %}
     *
     * Результаты возвращаются постранично, одна страница содержит не более 50 комментариев.
     *
     * Комментарии расположены в порядке публикации, поэтому вы можете передавать определенный идентификатор страницы в `page_token`, если вы получали его ранее.
     *
     * |**⚙️ Лимит:** 1 000 запросов в час|
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
     * @returns any Дерево комментариев к отзыву.
     * @throws ApiError
     */
    public static getGoodsFeedbackComments(
        businessId: number,
        requestBody: {
            /**
             * Идентификатор отзыва.
             *
             */
            feedbackId?: number;
            /**
             * Идентификаторы комментариев.
             *
             * ⚠️ Не используйте это поле одновременно с другими фильтрами. Если вы хотите воспользоваться ими, оставьте поле пустым.
             *
             */
            commentIds?: Array<paths_1businesses_1_businessId_1goods_feedback_1comments_1delete_post_requestBody_content_application_1json_schema_properties_id> | null;
        },
        pageToken?: string,
        limit?: number,
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/goods-feedback/comments',
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
}
