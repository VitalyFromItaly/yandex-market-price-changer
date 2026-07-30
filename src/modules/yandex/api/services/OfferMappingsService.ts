/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_barcodes } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_barcodes';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_category } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_category';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_description } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_description';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_name } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_name';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendor } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendor';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendorCode } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendorCode';
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_1updates_post_requestBody_content_application_1json_schema_properties_offerMappingEntries_items_allOf_1_properties_mapping } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_1updates_post_requestBody_content_application_1json_schema_properties_offerMappingEntries_items_allOf_1_properties_mapping';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_get_parameters_4_schema_items } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_get_parameters_4_schema_items';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_get_parameters_5_schema_items } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_get_parameters_5_schema_items';
import type { paths_1campaigns_1_campaignId_1offer_prices_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_marketSku } from '../models/paths_1campaigns_1_campaignId_1offer_prices_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_marketSku';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OfferMappingsService {
  /**
   * @deprecated
   * Список товаров в каталоге
   * {% include notitle [access](../../_auto/method_scopes/getOfferMappingEntries.md) %}
   *
   * {% note warning "Какой метод использовать вместо устаревшего" %}
   *
   * [POST businesses/{businessId}/offer-mappings](../../reference/business-assortment/getOfferMappings.md)
   *
   * {% endnote %}
   *
   * Для каждого товара, который вы размещаете на Маркете, возвращается информация о карточках Маркета, к которым привязан этот товар:
   *
   * * Идентификатор текущей карточки (marketSku), карточки, которая проходит модерацию и последней отклоненной карточки.
   * * Описание товара, которое указано на карточке Маркета. Например, размер упаковки и вес товара.
   *
   * Результаты возвращаются постранично. Выходные данные содержат идентификатор следующей страницы.
   *
   * {% note info "Как считается количество товаров в каталоге магазина" %}
   *
   * По данным за последние семь дней (не включая сегодня).
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 10 000 товаров в минуту|
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
   * @param offerId Идентификатор товара в каталоге.
   * @param shopSku Ваш SKU товара.
   *
   * Параметр может быть указан несколько раз, например:
   *
   * ```text translate=no
   * ...shop_sku=123&shop_sku=129&shop_sku=141...
   * ```
   *
   * В запросе можно указать либо параметр `shopSku`, либо любые параметры для фильтрации товаров. Совместное использование параметра `shopSku` и параметров для фильтрации приведет к ошибке.
   *
   * @param mappingKind Тип маппинга.
   * @param status Фильтрация по статусу публикации товара:
   *
   * * `READY` — товар прошел модерацию.
   * * `IN_WORK` — товар проходит модерацию.
   * * `NEED_CONTENT` — для товара без SKU на Маркете marketSku нужно найти карточку самостоятельно или создать ее.
   * * `NEED_INFO` — товар не прошел модерацию из-за ошибок или недостающих сведений в описании товара.
   * * `REJECTED` — товар не прошел модерацию, так как Маркет не планирует размещать подобные товары.
   * * `SUSPENDED` — товар не прошел модерацию, так как Маркет пока не размещает подобные товары.
   * * `OTHER` — товар не прошел модерацию по другой причине.
   *
   * Можно указать несколько статусов в одном параметре, через запятую, или в нескольких одинаковых параметрах. Например:
   *
   * ```text translate=no
   * ...status=READY,IN_WORK...
   * ...status=READY&status=IN_WORK...
   * ```
   *
   * В запросе можно указать либо параметр shopSku, либо любые параметры для фильтрации товаров. Совместное использование параметра shopSku и параметров для фильтрации приведет к ошибке.
   *
   * @param availability Фильтрация по планам поставок товара:
   *
   * * `ACTIVE` — поставки будут.
   * * `INACTIVE` — поставок не будет: товар есть на складе, но вы больше не планируете его поставлять.
   * * `DELISTED` — архив: товар закончился на складе, и его поставок больше не будет.
   *
   * Можно указать несколько значений в одном параметре, через запятую, или в нескольких одинаковых параметрах. Например:
   *
   * ```text translate=no
   * ...availability=INACTIVE,DELISTED...
   * ...availability=INACTIVE&availability=DELISTED...
   * ```
   *
   * В запросе можно указать либо параметр `shopSku`, либо любые параметры для фильтрации товаров. Совместное использование параметра `shopSku` и параметров для фильтрации приведет к ошибке.
   *
   * @param categoryId Фильтрация по идентификатору категории на Маркете.
   *
   * Чтобы узнать идентификатор категории, к которой относится товар, воспользуйтесь запросом [POST categories/tree](../../reference/categories/getCategoriesTree.md).
   *
   * Можно указать несколько идентификаторов в одном параметре, через запятую, или в нескольких одинаковых параметрах. Например:
   *
   * ```text translate=no
   * ...category_id=14727164,14382343...
   * ...category_id=14727164&category_id=14382343...
   * ```
   *
   * В запросе можно указать либо параметр `shopSku`, либо любые параметры для фильтрации товаров. Совместное использование параметра `shopSku` и параметров для фильтрации приведет к ошибке.
   *
   * @param vendor Фильтрация по бренду товара.
   *
   * Можно указать несколько брендов в одном параметре, через запятую, или в нескольких одинаковых параметрах. Например:
   *
   * ```text translate=no
   * ...vendor=Aqua%20Minerale,Borjomi...
   * ...vendor=Aqua%20Minerale&vendor=Borjomi...
   * ```
   *
   * Чтобы товар попал в результаты фильтрации, его бренд должен точно совпадать с одним из указанных в запросе. Например, если указан бренд Schwarzkopf, то в результатах не будет товаров Schwarzkopf Professional.
   *
   * Если в названии бренда есть символы, которые не входят в таблицу ASCII (в том числе кириллические символы), используйте для них URL-кодирование. Например, пробел — %20, апостроф «'» — %27 и т. д. Подробнее см. в разделе [Кодирование URL русскоязычной Википедии](https://ru.wikipedia.org/wiki/URL#Кодирование_URL).
   *
   * В запросе можно указать либо параметр shopSku, либо любые параметры для фильтрации товаров. Совместное использование параметра shopSku и параметров для фильтрации приведет к ошибке.
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
   * @returns any Информация о товарах в каталоге.
   * @throws ApiError
   */
  public static getOfferMappingEntries(
    campaignId: number,
    offerId?: Array<string>,
    shopSku?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>,
    mappingKind?: 'ACTIVE' | 'ALL',
    status?: Array<
      | 'UNKNOWN'
      | 'READY'
      | 'IN_WORK'
      | 'NEED_INFO'
      | 'NEED_MAPPING'
      | 'NEED_CONTENT'
      | 'CONTENT_PROCESSING'
      | 'SUSPENDED'
      | 'REJECTED'
      | 'REVIEW'
      | 'CREATE_ERROR'
      | 'UPDATE_ERROR'
    >,
    availability?: Array<'ACTIVE' | 'INACTIVE' | 'DELISTED'>,
    categoryId?: Array<number>,
    vendor?: Array<string>,
    pageToken?: string,
    limit?: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/offer-mapping-entries',
      path: {
        campaignId: campaignId,
      },
      query: {
        offer_id: offerId,
        shop_sku: shopSku,
        mapping_kind: mappingKind,
        status: status,
        availability: availability,
        category_id: categoryId,
        vendor: vendor,
        page_token: pageToken,
        limit: limit,
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
   * Добавление и редактирование товаров в каталоге
   * {% include notitle [access](../../_auto/method_scopes/updateOfferMappingEntries.md) %}
   *
   * {% note warning "Какой метод использовать вместо устаревшего" %}
   *
   * [POST businesses/{businessId}/offer-mappings/update](../../reference/business-assortment/updateOfferMappings.md)
   *
   * {% endnote %}
   *
   * Добавляет товары, указанные в запросе, в ваш каталог товаров и редактирует уже имеющиеся товары.
   *
   * Информацию о товарах нужно передать в теле POST-запроса.
   *
   * У каждого товара должен быть ваш SKU — уникальный код, который вы используете для идентификации товара:
   *
   * * Чтобы добавить в каталог новый товар, укажите в параметре `shopSku` ваш SKU, которого еще нет в каталоге.
   * * Чтобы отредактировать товар из каталога, укажите в параметре `shopSku` ваш SKU этого товара в каталоге.
   *
   * В обоих случаях в запросе нужно передать полное описание товара, даже если вы хотите изменить только несколько характеристик.
   *
   * Если вы знаете, какой карточке товара на Маркете соответствует ваш товар, укажите ее идентификатор (SKU на Маркете) во входном параметре mapping. Получить SKU на Маркете рекомендованной карточки товара можно через кабинет. Если SKU на Маркете не указан, сотрудники Маркета сами подберут или создадут подходящую карточку товара, либо у него появится статус `NEED_CONTENT` (нужно найти карточку или создать ее самостоятельно) в выходных данных запроса [POST businesses/{businessId}/offer-mappings](../../reference/business-assortment/getOfferMappings.md).
   *
   * Перед публикацией товары проходят модерацию. Если в одном из отправленных товаров найдена ошибка, ответ на запрос будет иметь HTTP-код 400 Bad Request, и ни один из товаров не отправится на модерацию. При этом если вы не передадите все обязательные параметры для какого‑либо товара, после модерации у него появится статус `NEED_INFO` (в описании товара не хватает информации) в выходных данных запроса [POST businesses/{businessId}/offer-mappings](../../reference/business-assortment/getOfferMappings.md).
   *
   * В одном запросе можно добавить не более 500 товаров.
   *
   * {% note info "Данные в каталоге обновляются не мгновенно" %}
   *
   * Это занимает до нескольких минут.
   *
   * {% endnote %}
   *
   * |**⚙️ Лимит:** 5 000 товаров в минуту|
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
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Статус выполнения операции.
   * @throws ApiError
   */
  public static updateOfferMappingEntries(
    campaignId: number,
    requestBody: {
      /**
       * Информация о товарах в каталоге.
       */
      offerMappingEntries: Array<{
        /**
         * Информация о карточке товара на Маркете.
         *
         * Если параметр не указан, сотрудники Маркета сами подберут или создадут подходящую карточку товара, либо у него появится статус `NEED_CONTENT` (нужно найти карточку или создать ее самостоятельно) в выходных данных запроса [POST businesses/{businessId}/offer-mappings](../../reference/business-assortment/getOfferMappings.md).
         *
         */
        mapping?: {
          /**
           * SKU на Маркете — идентификатор карточки товара на Маркете.
           *
           * При первом запросе marketSku привязывает товар к карточке Маркета. В дальнейшем изменить SKU через отправку запроса нельзя, для этого нужно обратиться в службу поддержки.
           *
           */
          marketSku?: paths_1campaigns_1_campaignId_1offer_prices_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_marketSku;
          /**
           * Идентификатор модели для текущей карточки товара на Маркете.
           *
           * Например, две лопатки разных цветов имеют разные SKU на Маркете (параметр `marketSku`), но одинаковый идентификатор модели товара.
           *
           */
          modelId?: number;
          /**
           * Идентификатор категории для текущей карточки товара на Маркете.
           */
          categoryId?: number;
        };
        /**
         * Информация о карточке товара на Маркете, проходящей модерацию для данного товара
         */
        awaitingModerationMapping?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1updates_post_requestBody_content_application_1json_schema_properties_offerMappingEntries_items_allOf_1_properties_mapping;
        /**
         * Информация о последней карточке товара на Маркете, отклоненной на модерации для данного товара
         */
        rejectedMapping?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1updates_post_requestBody_content_application_1json_schema_properties_offerMappingEntries_items_allOf_1_properties_mapping;
      }>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offer-mapping-entries/updates',
      path: {
        campaignId: campaignId,
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
  /**
   * @deprecated
   * Рекомендованные карточки для товаров
   * {% include notitle [access](../../_auto/method_scopes/getSuggestedOfferMappingEntries.md) %}
   *
   * Возвращает идентификаторы карточек товаров на Маркете, рекомендованных для ваших товаров.
   *
   * Каждому товару, который вы размещаете, должна соответствовать карточка товара на Маркете со своим идентификатором — SKU на Маркете. Он указывается в URL карточки товара, после «...sku=», например:
   *
   * ##https://market.yandex.ru/product--yandex-kniga/484830016?sku=484830016…##
   *
   * Чтобы получить для товаров рекомендованные SKU на Маркете, передайте в теле POST-запроса как можно больше информации о них: названия, производителей, штрихкоды, цены и т. д.
   *
   * Полученные SKU можно передать вместе с информацией о ваших товарах с помощью запроса [POST businesses/{businessId}/offer-mappings/update](../../reference/business-assortment/updateOfferMappings.md).
   *
   * В одном запросе можно получить не более 500 рекомендаций.
   *
   * |**⚙️ Лимит:** 100 000 рекомендаций в час|
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
   * @returns any Информация о товарах в каталоге.
   * @throws ApiError
   */
  public static getSuggestedOfferMappingEntries(
    campaignId: number,
    requestBody: {
      /**
       * Список товаров.
       */
      offers: Array<{
        name?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_name;
        shopSku?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        category?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_category;
        vendor?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendor;
        vendorCode?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendorCode;
        description?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_description;
        id?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Идентификатор фида.
         */
        feedId?: number;
        barcodes?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_barcodes;
        /**
         * URL фотографии товара или страницы с описанием на вашем сайте.
         *
         * Переданные данные не будут отображаться на витрине, но они помогут специалистам Маркета найти карточку для вашего товара.
         *
         * Должен содержать один вложенный параметр url.
         *
         */
        urls?: Array<string> | null;
        /**
         * Ссылки (URL) изображений товара в хорошем качестве.
         *
         * Можно указать до 30 ссылок. При этом изображение по первой ссылке будет основным. Оно используется в качестве изображения товара в поиске Маркета и на карточке товара. Другие изображения товара доступны в режиме просмотра увеличенных изображений.
         *
         * Должен содержать хотя бы один вложенный параметр `picture`.
         *
         */
        pictures?: Array<string> | null;
        /**
         * Изготовитель товара: компания, которая произвела товар, ее адрес и регистрационный номер (если есть).
         *
         * Необязательный параметр.
         *
         */
        manufacturer?: string;
        /**
         * Список стран, в которых произведен товар.
         *
         * Обязательный параметр.
         *
         * Должен содержать хотя бы одну, но не больше 5 стран.
         *
         */
        manufacturerCountries?: Array<string> | null;
        /**
         * Минимальное количество единиц товара, которое вы поставляете на склад.
         *
         * Например, если вы поставляете детское питание партиями минимум по 10 коробок, а в каждой коробке по 6 баночек, укажите значение 60.
         *
         */
        minShipment?: number;
        /**
         * Количество единиц товара в одной упаковке, которую вы поставляете на склад.
         *
         * Например, если вы поставляете детское питание коробками по 6 баночек, укажите значение 6.
         *
         */
        transportUnitSize?: number;
        /**
         * Добавочная партия: по сколько единиц товара можно добавлять к минимальному количеству minShipment.
         *
         * Например, если вы поставляете детское питание партиями минимум по 10 коробок и хотите добавлять к минимальной партии по 2 коробки, а в каждой коробке по 6 баночек, укажите значение 12.
         *
         */
        quantumOfSupply?: number;
        /**
         * Срок, за который продавец поставляет товары на склад, в днях.
         */
        deliveryDurationDays?: number;
        /**
         * Сколько мест (если больше одного) занимает товар.
         *
         * Параметр указывается, только если товар занимает больше одного места (например, кондиционер занимает два места: внешний и внутренний блоки в двух коробках). Если товар занимает одно место, не указывайте этот параметр.
         *
         */
        boxCount?: number;
        /**
         * Список кодов товара в единой Товарной номенклатуре внешнеэкономической деятельности (ТН ВЭД).
         *
         * Обязательный параметр, если товар подлежит особому учету (например, в системе «Меркурий» как продукция животного происхождения или в системе «Честный ЗНАК»).
         *
         * Может содержать только один вложенный код ТН ВЭД.
         *
         */
        customsCommodityCodes?: Array<string> | null;
        /**
         * Габариты упаковки и вес товара.
         *
         */
        weightDimensions?: {
          /**
           * Длина упаковки в см.
           *
           */
          length: number;
          /**
           * Ширина упаковки в см.
           *
           */
          width: number;
          /**
           * Высота упаковки в см.
           *
           */
          height: number;
          /**
           * Вес товара в кг с учетом упаковки (брутто).
           *
           */
          weight: number;
        };
        /**
         * Дни недели, в которые продавец поставляет товары на склад.
         */
        supplyScheduleDays?: Array<
          'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
        > | null;
        /**
         * {% note warning "Вместо него используйте `shelfLife`. Совместное использование обоих параметров приведет к ошибке." %}
         *
         *
         *
         * {% endnote %}
         *
         * Срок годности: через сколько дней товар станет непригоден для использования.
         *
         * @deprecated
         */
        shelfLifeDays?: number;
        /**
         * {% note warning "Вместо него используйте `lifeTime`. Совместное использование обоих параметров приведет к ошибке." %}
         *
         *
         *
         * {% endnote %}
         *
         * Срок службы: сколько дней товар будет исправно выполнять свою функцию, а изготовитель — нести ответственность за его существенные недостатки.
         *
         * @deprecated
         */
        lifeTimeDays?: number;
        /**
         * Гарантийный срок товара: сколько дней возможно обслуживание и ремонт товара или возврат денег, а изготовитель или продавец будет нести ответственность за недостатки товара.
         *
         */
        guaranteePeriodDays?: number;
        /**
         * Информация о статусе публикации товара на Маркете.
         */
        processingState?: {
          /**
           * Статус публикации товара
           */
          status?: paths_1campaigns_1_campaignId_1offer_mapping_entries_get_parameters_4_schema_items;
          /**
           * Причины, по которым товар не прошел модерацию.
           */
          notes?: Array<{
            /**
             * Тип причины, по которой товар не прошел модерацию.
             */
            type?:
              | 'ASSORTMENT'
              | 'CANCELLED'
              | 'CONFLICTING_INFORMATION'
              | 'OTHER'
              | 'DEPARTMENT_FROZEN'
              | 'INCORRECT_INFORMATION'
              | 'LEGAL_CONFLICT'
              | 'NEED_CLASSIFICATION_INFORMATION'
              | 'NEED_INFORMATION'
              | 'NEED_PICTURES'
              | 'NEED_VENDOR'
              | 'NO_CATEGORY'
              | 'NO_KNOWLEDGE'
              | 'NO_PARAMETERS_IN_SHOP_TITLE'
              | 'NO_SIZE_MEASURE'
              | 'SAMPLE_LINE';
            /**
             * Дополнительная информация о причине отклонения товара.
             *
             */
            payload?: string;
          }> | null;
        };
        /**
         * Планы по поставкам:
         *
         * * `ACTIVE` — поставки будут.
         * * `INACTIVE` — поставок не будет: товар есть на складе, но вы больше не планируете его поставлять. Через 60 дней после того, как товар закончится на складе, этот статус изменится на `DELISTED`.
         * * `DELISTED` — архив: товар закончился на складе, и его поставок больше не будет. Если товар вернется на склад (например, покупатель вернет заказ), этот статус изменится на `INACTIVE`.
         *
         * Значения по умолчанию:
         *
         * * при добавлении товара — `ACTIVE`;
         * * при редактировании товара — такое же, как и при последнем обновлении каталога (в том числе другими способами, не через партнерский API).
         *
         */
        availability?: paths_1campaigns_1_campaignId_1offer_mapping_entries_get_parameters_5_schema_items;
        /**
         * Информация о сроке годности: через какое время (в годах, месяцах, днях, неделях или часах) товар станет непригоден для использования. Например, срок годности есть у таких категорий, как продукты питания и медицинские препараты.
         *
         * Обязательный параметр, если у товара есть срок годности.
         *
         * {% note alert "У товара есть срок годности, а вы не укажете его" %}
         *
         * Товар будет скрыт с Маркета.
         *
         * {% endnote %}
         *
         */
        shelfLife?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime;
        /**
         * Информация о сроке службы: в течение какого периода (в годах, месяцах, днях, неделях или часах) товар будет исправно выполнять свою функцию, а изготовитель — нести ответственность за его существенные недостатки.
         *
         * Обязательный параметр, если у товара есть срок службы.
         *
         * {% note alert "У товара есть срок службы, а вы не укажете его" %}
         *
         * Товар будет скрыт с Маркета.
         *
         * {% endnote %}
         *
         */
        lifeTime?: {
          /**
           * Продолжительность в указанных единицах.
           */
          timePeriod: number;
          /**
           * Единица измерения.
           */
          timeUnit: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
          /**
           * Комментарий.
           */
          comment?: string;
        };
        /**
         * Информация о гарантийном сроке: в течение какого периода (в годах, месяцах, днях, неделях или часах) возможны обслуживание и ремонт товара или возврат денег, а изготовитель или продавец будет нести ответственность за недостатки товара.
         *
         * Обязательный параметр, если у товара есть гарантийный срок.
         *
         * {% note alert "У товара есть гарантийный срок, а вы не укажете его" %}
         *
         * Товар будет скрыт с Маркета.
         *
         * {% endnote %}
         *
         */
        guaranteePeriod?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime;
        /**
         * Номер документа на товар.
         *
         * Перед указанием номера документ нужно загрузить в кабинете продавца на Маркете. [Инструкция](https://yandex.ru/support/marketplace/assortment/restrictions/certificates.html)
         *
         */
        certificate?: string;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/offer-mapping-entries/suggestions',
      path: {
        campaignId: campaignId,
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
