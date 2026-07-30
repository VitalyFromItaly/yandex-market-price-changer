/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_categoryIds_items } from '../models/paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_categoryIds_items';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ContentService {
  /**
   * Списки характеристик товаров по категориям
   * {% include notitle [access](../../_auto/method_scopes/getCategoryContentParameters.md) %}
   *
   * Возвращает список характеристик с допустимыми значениями для заданной листовой категории — той, у которой нет дочерних категорий.
   *
   * |**⚙️ Лимит:** 100 категорий в минуту |
   * |-|
   *
   * @param categoryId Идентификатор категории на Маркете.
   *
   * Чтобы узнать идентификатор категории, к которой относится интересующий вас товар, воспользуйтесь запросом [POST categories/tree](../../reference/categories/getCategoriesTree.md).
   *
   * @returns any Список характеристик товаров из заданной категории.
   * @throws ApiError
   */
  public static getCategoryContentParameters(
    categoryId: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/category/{categoryId}/parameters',
      path: {
        categoryId: categoryId,
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
   * Получение информации о заполненности карточек магазина
   * {% include notitle [access](../../_auto/method_scopes/getOfferCardsContentStatus.md) %}
   *
   * Возвращает сведения о состоянии контента для заданных товаров:
   *
   * * создана ли карточка товара и в каком она статусе;
   * * рейтинг карточки — на сколько процентов она заполнена;
   * * переданные характеристики товаров;
   * * есть ли ошибки или предупреждения, связанные с контентом;
   * * рекомендации по заполнению карточки.
   *
   * |**⚙️ Лимит:** 600 запросов в минуту|
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
   * @returns any Информация о карточках указанных товаров.
   * @throws ApiError
   */
  public static getOfferCardsContentStatus(
    businessId: number,
    pageToken?: string,
    limit?: number,
    requestBody?: {
      /**
       * Идентификаторы товаров, информация о которых нужна.
       * <br><br>
       * ⚠️ Не используйте это поле одновременно с фильтрами по статусам карточек, категориям, брендам или тегам. Если вы хотите воспользоваться фильтрами, оставьте поле пустым.
       *
       */
      offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
      /**
       * Фильтр по статусам карточек.
       *
       * [Что такое карточка товара](https://yandex.ru/support/marketplace/assortment/content/index.html)
       *
       */
      cardStatuses?: Array<
        | 'HAS_CARD_CAN_NOT_UPDATE'
        | 'HAS_CARD_CAN_UPDATE'
        | 'HAS_CARD_CAN_UPDATE_ERRORS'
        | 'HAS_CARD_CAN_UPDATE_PROCESSING'
        | 'NO_CARD_NEED_CONTENT'
        | 'NO_CARD_MARKET_WILL_CREATE'
        | 'NO_CARD_ERRORS'
        | 'NO_CARD_PROCESSING'
        | 'NO_CARD_ADD_TO_CAMPAIGN'
      > | null;
      /**
       * Фильтр по категориям на Маркете.
       */
      categoryIds?: Array<number> | null;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/offer-cards',
      path: {
        businessId: businessId,
      },
      query: {
        page_token: pageToken,
        limit: limit,
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
   * Редактирование категорийных характеристик товара
   * {% include notitle [access](../../_auto/method_scopes/updateOfferContent.md) %}
   *
   * Редактирует характеристики товара, которые специфичны для категории, к которой он относится.
   *
   * {% note warning "Здесь только то, что относится к конкретной категории" %}
   *
   * Если вам нужно изменить основные параметры товара (название, описание, изображения, видео, производитель, штрихкод), воспользуйтесь запросом [POST businesses/{businessId}/offer-mappings/update](../../reference/business-assortment/updateOfferMappings.md).
   *
   * {% endnote %}
   *
   * Чтобы удалить характеристики, которые заданы в параметрах с типом `string`, передайте пустое значение.
   *
   * {% note info "Данные в каталоге обновляются не мгновенно" %}
   *
   * Это занимает до нескольких минут.
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту|
   * |-|
   *
   * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
   *
   * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
   *
   * @param requestBody
   * @returns any Запрос выполнен корректно, данные обработаны.
   *
   * {% note warning "Ответ 200 сам по себе не значит, что переданные значения корректны" %}
   *
   * Обязательно посмотрите детали ответа: `status` и перечень ошибок, если он есть.
   *
   * Даже если ошибка допущена в характеристиках всего одного товара, никакие изменения из запроса в каталог не попадут.
   *
   * {% endnote %}
   *
   * Если в `status` вернулось `ERROR`, убедитесь, что:
   *
   * * все обязательные характеристики заполнены;
   * * характеристики действительно существуют в указанных категориях;
   * * значения соответствуют характеристикам;
   * * ваши собственные значения имеют нужный тип данных.
   *
   * Найти проблемы помогут поля `errors` и `warnings`.
   *
   * @throws ApiError
   */
  public static updateOfferContent(
    businessId: number,
    requestBody: {
      /**
       * Список товаров с указанными характеристиками.
       */
      offersContent: Array<{
        offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        categoryId: paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_categoryIds_items;
        /**
         * Список характеристик с их значениями.
         *
         * С `parameterValues` обязательно передавайте `categoryId` — идентификатор категории на Маркете, к которой относятся указанные характеристики товара.
         *
         * При **изменении** характеристик передавайте только те, значение которых нужно обновить. Если в `categoryId` вы меняете категорию, значения общих характеристик для старой и новой категории сохранятся, передавать их не нужно.
         *
         * Чтобы **удалить** значение заданной характеристики, передайте ее `parameterId` с пустым `value`.
         *
         */
        parameterValues: Array<{
          /**
           * Идентификатор характеристики.
           */
          parameterId: number;
          /**
           * Идентификатор единицы измерения. Если вы не передали параметр `unitId`, используется единица измерения по умолчанию.
           */
          unitId?: number;
          /**
           * Идентификатор значения.
           *
           * Обязательно указывайте идентификатор, если передаете значение из перечня допустимых значений, полученного от Маркета.
           *
           * Только для характеристик типа `ENUM`.
           *
           */
          valueId?: number;
          /**
           * Значение.
           */
          value?: string;
        }>;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/businesses/{businessId}/offer-cards/update',
      path: {
        businessId: businessId,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        404: `Запрашиваемый ресурс не найден.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        423: `К ресурсу нельзя применить указанный метод.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
}
