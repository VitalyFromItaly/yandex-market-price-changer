/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_cardStatuses_items } from '../models/paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_cardStatuses_items';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_barcodes } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_barcodes';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_category } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_category';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_description } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_description';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_name } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_name';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendor } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendor';
import type { paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendorCode } from '../models/paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendorCode';
import type { paths_1businesses_1_businessId_1offer_prices_1updates_post_requestBody_content_application_1json_schema_properties_offers_items_properties_price_allOf_0_allOf_0 } from '../models/paths_1businesses_1_businessId_1offer_prices_1updates_post_requestBody_content_application_1json_schema_properties_offers_items_properties_price_allOf_0_allOf_0';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime';
import type { paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_weightDimensions } from '../models/paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_weightDimensions';
import type { paths_1campaigns_1_campaignId_1offer_prices_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_marketSku } from '../models/paths_1campaigns_1_campaignId_1offer_prices_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_marketSku';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class BusinessOfferMappingsService {
    /**
     * Удаление товаров из каталога
     * {% include notitle [access](../../_auto/method_scopes/deleteOffers.md) %}
     *
     * Удаляет товары из каталога.
     *
     * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 200 товаров в одном запросе|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Если удалось удалить не все товары, с ответом 200 вернется список тех, что были в запросе, но остались в магазине.
     * @throws ApiError
     */
    public static deleteOffers(
        businessId: number,
        requestBody: {
            /**
             * Список SKU товаров, которые нужно удалить.
             */
            offerIds: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/offer-mappings/delete',
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
                423: `К ресурсу нельзя применить указанный метод.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Информация о товарах в каталоге
     * {% include notitle [access](../../_auto/method_scopes/getOfferMappings.md) %}
     *
     * Возвращает список товаров в каталоге, их категории на Маркете и характеристики каждого товара.
     *
     * Можно использовать тремя способами:
     * * задать список интересующих SKU;
     * * задать фильтр — в этом случае результаты возвращаются постранично;
     * * не передавать тело запроса, чтобы получить список всех товаров в каталоге.
     *
     * |**⚙️ Лимит:** 600 запросов в минуту, не более 200 товаров в одном запросе|
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
     * @param language Язык, на котором принимаются и возвращаются значения в параметрах `name` и `description`.
     *
     * Значение по умолчанию: `RU`.
     *
     * @param requestBody
     * @returns any Информация о товарах в каталоге.
     * @throws ApiError
     */
    public static getOfferMappings(
        businessId: number,
        pageToken?: string,
        limit?: number,
        language?: 'RU' | 'UZ',
        requestBody?: {
            /**
             * Идентификаторы товаров, информация о которых нужна.
             *
             * {% note warning "Такой список возвращается только целиком" %}
             *
             * Если вы запрашиваете информацию по конкретным SKU, не заполняйте:
             * * `page_token`;
             * * `limit`;
             * * `cardStatuses`;
             * * `categoryIds`;
             * * `vendorNames`;
             * * `tags`;
             * * `archived`.
             *
             * {% endnote %}
             *
             *
             *
             */
            offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
            /**
             * Фильтр по статусам карточек.
             *
             * [Что такое карточка товара](https://yandex.ru/support/marketplace/assortment/content/index.html)
             *
             */
            cardStatuses?: Array<paths_1businesses_1_businessId_1offer_cards_post_requestBody_content_application_1json_schema_properties_cardStatuses_items> | null;
            /**
             * Фильтр по категориям на Маркете.
             */
            categoryIds?: Array<number> | null;
            /**
             * Фильтр по брендам.
             */
            vendorNames?: Array<string> | null;
            /**
             * Фильтр по тегам.
             */
            tags?: Array<string> | null;
            /**
             * Фильтр по нахождению в архиве.
             *
             * Передайте `true`, чтобы получить товары, находящиеся в архиве. Если фильтр не заполнен или передано `false`, в ответе возвращаются товары, не находящиеся в архиве.
             *
             */
            archived?: boolean;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/offer-mappings',
            path: {
                'businessId': businessId,
            },
            query: {
                'page_token': pageToken,
                'limit': limit,
                'language': language,
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
     * Добавление товаров в каталог и изменение информации о них
     * {% include notitle [access](../../_auto/method_scopes/updateOfferMappings.md) %}
     *
     * Добавляет товары в каталог и передает:
     *
     * * их категории на Маркете и категорийные характеристики;
     * * основные характеристики;
     * * цены на товары в кабинете.
     *
     * Также объединяет товары на карточке, редактирует и удаляет информацию об уже добавленных товарах, в том числе цены в кабинете и категории товаров.
     *
     * Список категорий Маркета можно получить с помощью запроса [POST categories/tree](../../reference/categories/getCategoriesTree.md), а характеристики товаров по категориям с помощью [POST category/{categoryId}/parameters](../../reference/content/getCategoryContentParameters.md).
     *
     * {% cut "Добавить новый товар" %}
     *
     * Передайте его с новым идентификатором, который раньше никогда не использовался в каталоге.
     *
     * Обязательно укажите параметры: `offerId`, `name`, `marketCategoryId`, `pictures`, `vendor`, `description`.
     *
     * Старайтесь сразу передать как можно больше информации — она потребуется Маркету для подбора подходящей карточки или создания новой.
     *
     * Если известно, какой карточке на Маркете соответствует товар, можно сразу указать идентификатор этой карточки (**SKU на Маркете**) в поле `marketSKU`.
     *
     * **Для продавцов Market Yandex Go:**
     *
     * Когда вы добавляете товары в каталог, указывайте значения параметров `name` и `description` на русском языке. Чтобы на витрине они отображались и на другом языке, еще раз выполните запрос `POST businesses/{businessId}/offer-mappings/update`, где укажите:
     *
     * * язык в параметре `language`;
     * * значения параметров `name` и `description` на указанном языке.
     *
     * Повторно передавать остальные характеристики товара не нужно.
     *
     * {% endcut %}
     *
     * {% cut "Изменить информацию о товаре" %}
     *
     * Передайте новые данные, указав в `offerId` соответствующий **ваш SKU**.
     *
     * Поля, в которых ничего не меняется, можно не передавать.
     *
     * {% endcut %}
     *
     * {% cut "Удалить переданные ранее параметры товара" %}
     *
     * В `deleteParameters` укажите значения параметров, которые хотите удалить. Можно передать сразу несколько значений.
     *
     * Для параметров с типом `string` также можно передать пустое значение.
     *
     * {% endcut %}
     *
     * Параметр `offerId` должен быть **уникальным** для всех товаров, которые вы передаете.
     *
     * {% note warning "Правила использования SKU" %}
     *
     * * У каждого товара SKU должен быть свой.
     *
     * * Уже заданный SKU нельзя освободить и использовать заново для другого товара. Каждый товар должен получать новый идентификатор, до того никогда не использовавшийся в вашем каталоге.
     *
     * SKU товара можно изменить в кабинете продавца на Маркете. О том, как это сделать, читайте [в Справке Маркета для продавцов](https://yandex.ru/support2/marketplace/ru/assortment/operations/edit-sku).
     *
     * {% endnote %}
     *
     * {% note info "Данные в каталоге обновляются не мгновенно" %}
     *
     * Это занимает до нескольких минут.
     *
     * {% endnote %}
     *
     * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 100 товаров в одном запросе|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @param language Язык, на котором принимаются и возвращаются значения в параметрах `name` и `description`.
     *
     * Значение по умолчанию: `RU`.
     *
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
     * @throws ApiError
     */
    public static updateOfferMappings(
        businessId: number,
        requestBody: {
            /**
             * Перечень товаров, которые нужно добавить или обновить.
             */
            offerMappings: Array<{
                /**
                 * Параметры товара.
                 */
                offer: {
                    offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
                    name?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_name;
                    /**
                     * Идентификатор категории на Маркете, к которой вы относите свой товар.
                     *
                     * При изменении категории убедитесь, что характеристики товара и их значения в параметре `parameterValues` вы передаете для новой категории.
                     *
                     * Список категорий Маркета можно получить с помощью запроса  [POST categories/tree](../../reference/categories/getCategoriesTree.md).
                     *
                     */
                    marketCategoryId?: number;
                    category?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_category;
                    /**
                     * Ссылки на изображения товара. Изображение по первой ссылке считается основным, остальные дополнительными.
                     *
                     * **Требования к ссылкам**
                     *
                     * * Ссылок может быть до 30.
                     * * Указывайте ссылку целиком, включая протокол http или https.
                     * * Максимальная длина — 512 символов.
                     * * Русские буквы в URL можно.
                     * * Можно использовать прямые ссылки на изображения и на Яндекс Диск. Ссылки на Яндекс Диске нужно копировать с помощью функции **Поделиться**. Относительные ссылки и ссылки на другие облачные хранилища — не работают.
                     *
                     * ✅ `https://example-shop.ru/images/sku12345.jpg`
                     *
                     * ✅ `https://yadi.sk/i/NaBoRsimVOLov`
                     *
                     * ❌ `/images/sku12345.jpg`
                     *
                     * ❌ `https://www.dropbox.com/s/818f/tovar.jpg`
                     *
                     * Ссылки на изображение должны быть постоянными. Нельзя использовать динамические ссылки, меняющиеся от выгрузки к выгрузке.
                     *
                     * Если нужно заменить изображение, выложите новое изображение по новой ссылке, а ссылку на старое удалите. Если просто заменить изображение по старой ссылке, оно не обновится.
                     *
                     * [Требования к изображениям](https://yandex.ru/support/marketplace/assortment/fields/images.html)
                     *
                     */
                    pictures?: Array<string> | null;
                    /**
                     * Ссылки (URL) на видео товара.
                     *
                     * **Требования к ссылке**
                     *
                     * * Указывайте ссылку целиком, включая протокол http или https.
                     * * Максимальная длина — 512 символов.
                     * * Русские буквы в URL можно.
                     * * Можно использовать прямые ссылки на видео и на Яндекс Диск. Ссылки на Яндекс Диске нужно копировать с помощью функции **Поделиться**. Относительные ссылки и ссылки на другие облачные хранилища — не работают.
                     *
                     * ✅ `https://example-shop.ru/video/sku12345.avi`
                     *
                     * ✅ `https://yadi.sk/i/NaBoRsimVOLov`
                     *
                     * ❌ `/video/sku12345.avi`
                     *
                     * ❌ `https://www.dropbox.com/s/818f/super-tovar.avi`
                     *
                     * Ссылки на видео должны быть постоянными. Нельзя использовать динамические ссылки, меняющиеся от выгрузки к выгрузке.
                     *
                     * Если нужно заменить видео, выложите новое видео по новой ссылке, а ссылку на старое удалите. Если просто заменить видео по старой ссылке, оно не обновится.
                     *
                     * [Требования к видео](https://yandex.ru/support/marketplace/assortment/fields/video.html)
                     *
                     */
                    videos?: Array<string> | null;
                    /**
                     * Список инструкций по использованию товара.
                     *
                     * Максимальное количество инструкций — 6.
                     *
                     */
                    manuals?: Array<{
                        /**
                         * Ссылка на инструкцию.
                         */
                        url: string;
                        /**
                         * Название инструкции, которое будет отображаться на карточке товара.
                         *
                         */
                        title?: string;
                    }> | null;
                    vendor?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendor;
                    barcodes?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_barcodes;
                    description?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_description;
                    /**
                     * Страна, где был произведен товар.
                     *
                     * Записывайте названия стран так, как они записаны в [списке](https://yastatic.net/s3/doc-binary/src/support/market/ru/countries.xlsx).
                     *
                     */
                    manufacturerCountries?: Array<string> | null;
                    /**
                     * Габариты упаковки и вес товара.
                     *
                     */
                    weightDimensions?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_weightDimensions;
                    vendorCode?: paths_1businesses_1_businessId_1offer_mappings_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_vendorCode;
                    /**
                     * Метки товара, которые использует магазин. Покупателям теги не видны. По тегам можно группировать и фильтровать разные товары в каталоге — например, товары одной серии, коллекции или линейки.
                     *
                     * Максимальная длина тега — 20 символов. У одного товара может быть максимум 10 тегов.
                     *
                     */
                    tags?: Array<string> | null;
                    /**
                     * Срок годности — период, по прошествии которого товар становится непригоден.
                     *
                     * Указывайте срок, указанный на банке или упаковке. Текущая дата, дата поставки или дата отгрузки значения не имеет.
                     *
                     * Обязательно указывайте срок, если он есть.
                     *
                     * В комментарии укажите условия хранения. Например, `Хранить в сухом помещении`.
                     *
                     */
                    shelfLife?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime;
                    /**
                     * Срок службы — период, в течение которого товар должен исправно выполнять свою функцию.
                     *
                     * Обязательно указывайте срок, если он есть.
                     *
                     * В комментарии укажите условия хранения. Например, `Использовать при температуре не ниже −10 градусов`.
                     *
                     */
                    lifeTime?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime;
                    /**
                     * Гарантийный срок — период, в течение которого можно заменить или починить товар без дополнительной платы.
                     *
                     * Обязательно указывайте срок, если он есть.
                     *
                     * В комментарии опишите особенности гарантийного обслуживания. Например, `Гарантия на аккумулятор — 6 месяцев`.
                     *
                     */
                    guaranteePeriod?: paths_1campaigns_1_campaignId_1offer_mapping_entries_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_allOf_0_properties_lifeTime;
                    /**
                     * {% note warning "Вместо него используйте `commodityCodes` с типом `CUSTOMS_COMMODITY_CODE`." %}
                     *
                     *
                     *
                     * {% endnote %}
                     *
                     * Код товара в единой Товарной номенклатуре внешнеэкономической деятельности (ТН ВЭД) — 10 или 14 цифр без пробелов.
                     *
                     * Обязательно укажите, если он есть.
                     *
                     * @deprecated
                     */
                    customsCommodityCode?: string;
                    /**
                     * Товарные коды.
                     *
                     */
                    commodityCodes?: Array<{
                        /**
                         * Товарный код.
                         */
                        code: string;
                        /**
                         * Тип товарного кода.
                         */
                        type: 'CUSTOMS_COMMODITY_CODE' | 'IKPU_CODE';
                    }> | null;
                    /**
                     * Номера документов на товар: сертификата, декларации соответствия и т. п.
                     *
                     * Передавать можно только номера документов, сканы которого загружены в кабинете продавца по [инструкции](https://yandex.ru/support/marketplace/assortment/restrictions/certificates.html).
                     *
                     */
                    certificates?: Array<string> | null;
                    /**
                     * Количество грузовых мест.
                     *
                     * Параметр используется, если товар представляет собой несколько коробок, упаковок и так далее. Например, кондиционер занимает два места — внешний и внутренний блоки в двух коробках.
                     *
                     * Для товаров, занимающих одно место, не передавайте этот параметр.
                     *
                     */
                    boxCount?: number;
                    /**
                     * Состояние уцененного товара.
                     *
                     * Используется только для товаров, продаваемых с уценкой.
                     *
                     * [Правила продажи уцененных товаров](https://yandex.ru/support/marketplace/assortment/restrictions/used-goods.html)
                     *
                     */
                    condition?: {
                        /**
                         * Тип уценки.
                         *
                         */
                        type?: 'PREOWNED' | 'SHOWCASESAMPLE' | 'REFURBISHED' | 'REDUCTION' | 'RENOVATED' | 'NOT_SPECIFIED';
                        /**
                         * Внешний вид товара.
                         *
                         */
                        quality?: 'PERFECT' | 'EXCELLENT' | 'GOOD' | 'NOT_SPECIFIED';
                        /**
                         * Описание товара. Подробно опишите дефекты, насколько они заметны и где их искать.
                         *
                         */
                        reason?: string;
                    };
                    /**
                     * Особый тип товара. Указывается, если товар:
                     *
                     * * имеет особый тип, который хотите убрать;
                     * * лекарство;
                     * * бумажная или электронная книга;
                     * * аудиокнига;
                     * * музыка или видео;
                     * * изготовляется на заказ;
                     * * алкоголь.
                     *
                     */
                    type?: 'DEFAULT' | 'MEDICINE' | 'BOOK' | 'AUDIOBOOK' | 'ARTIST_TITLE' | 'ON_DEMAND' | 'ALCOHOL';
                    /**
                     * Признак цифрового товара. Укажите `true`, если товар доставляется по электронной почте.
                     *
                     * [Как работать с цифровыми товарами](../../step-by-step/digital.md)
                     *
                     */
                    downloadable?: boolean;
                    /**
                     * Параметр включает для товара пометку 18+. Устанавливайте ее только для товаров, которые относятся к удовлетворению сексуальных потребностей.
                     *
                     */
                    adult?: boolean;
                    /**
                     * Если товар не предназначен для детей младше определенного возраста, укажите это.
                     *
                     * Возрастное ограничение можно задавать в годах (с нуля, с 6, 12, 16 или 18) или в месяцах (любое число от 0 до 12).
                     *
                     */
                    age?: {
                        /**
                         * Значение.
                         *
                         */
                        value: number;
                        /**
                         * Единица измерения.
                         *
                         */
                        ageUnit: 'YEAR' | 'MONTH';
                    };
                    /**
                     * {% note warning "При передаче характеристик используйте `parameterValues`." %}
                     *
                     *
                     *
                     * {% endnote %}
                     *
                     * Характеристики, которые есть только у товаров конкретной категории — например, диаметр колес велосипеда или материал подошвы обуви.
                     *
                     * @deprecated
                     */
                    params?: Array<{
                        /**
                         * Название характеристики.
                         *
                         * Должно совпадать с названием характеристики на Маркете. Узнать его можно из Excel-шаблона категории или через запрос [POST category/{categoryId}/parameters](../../reference/content/getCategoryContentParameters.md).
                         *
                         */
                        name: string;
                        /**
                         * Значение.
                         *
                         */
                        value: string;
                    }> | null;
                };
                /**
                 * Информация о карточке товара на Маркете.
                 */
                mapping?: {
                    /**
                     * Идентификатор карточки на Маркете.
                     *
                     */
                    marketSku?: paths_1campaigns_1_campaignId_1offer_prices_1suggestions_post_requestBody_content_application_1json_schema_properties_offers_items_properties_marketSku;
                };
            }>;
            /**
             * Будут ли использоваться только переданные вами данные о товарах.
             *
             * Значение по умолчанию: `false`. Чтобы удалить данные, которые добавил Маркет, передайте значение `true`.
             *
             */
            onlyPartnerMediaContent?: boolean;
        },
        language?: 'RU' | 'UZ',
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/offer-mappings/update',
            path: {
                'businessId': businessId,
            },
            query: {
                'language': language,
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
     * Просмотр карточек на Маркете, которые подходят вашим товарам
     * {% include notitle [access](../../_auto/method_scopes/getSuggestedOfferMappings.md) %}
     *
     * Возвращает идентификаторы карточек на Маркете, которые соответствуют товарам с заданными параметрами.
     *
     * Пользоваться этим запросом необязательно: он просто помогает заранее убедиться, что Маркет верно определяет карточки по предоставленным вами данным.
     *
     * **Как пользоваться запросом**
     *
     * 1. Передайте Маркету список товаров, которые нужно проверить.
     * 2. В ответ вы получите список SKU на Маркете с расшифровкой: названием, идентификатором модели, категорией.
     * 3. Если расшифровки мало, вы можете открыть карточку. Для этого перейдите по ссылке вида `https://market.yandex.ru/product/<marketModelId>?sku=<marketSku>`.
     * 4. Если карточка соответствует товару, значит его можно добавлять в каталог с теми данными, что вы указали. Если карточка определилась неправильно — проверьте данные о товаре. Возможно, их нужно уточнить или дополнить. Кроме того, на этапе добавления товара вы можете указать `marketSKU`, который ему подходит по вашему мнению.
     *
     * {% note info "Как определить `marketSku` товара, найденного на Маркете?" %}
     *
     * Он есть в адресе страницы товара — расположен после `sku=`.
     *
     * Например, `https://market.yandex.ru/product--yandex-kniga/484830016?sku=484830016`
     *
     * {% endnote %}
     *
     * |**⚙️ Лимит:** 100 000 товаров в час|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Подобранные карточки на Маркете.
     *
     * По результатам проверки товара полученная через этот запрос карточка может быть заменена на другую.
     *
     * @throws ApiError
     */
    public static getSuggestedOfferMappings(
        businessId: number,
        requestBody?: {
            /**
             * Список товаров.
             */
            offers?: Array<{
                offerId?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
                /**
                 * Составляйте название по схеме: тип + бренд или производитель + модель + особенности, если есть (например, цвет, размер или вес) и количество в упаковке.
                 *
                 * Не включайте в название условия продажи (например, «скидка», «бесплатная доставка» и т. д.), эмоциональные характеристики («хит», «супер» и т. д.). Не пишите слова большими буквами — кроме устоявшихся названий брендов и моделей.
                 *
                 * Оптимальная длина — 50–60 символов.
                 *
                 * [Рекомендации и правила](https://yandex.ru/support/marketplace/assortment/fields/title.html)
                 *
                 */
                name?: string;
                /**
                 * {% note warning "Вместо него используйте `marketCategoryId`." %}
                 *
                 *
                 *
                 * {% endnote %}
                 *
                 * Категория товара в вашем магазине.
                 *
                 * @deprecated
                 */
                category?: string;
                /**
                 * Название бренда или производителя. Должно быть записано так, как его пишет сам бренд.
                 */
                vendor?: string;
                /**
                 * Указывайте в виде последовательности цифр. Подойдут коды EAN-13, EAN-8, UPC-A, UPC-E или Code 128.
                 *
                 * Для книг указывайте ISBN.
                 *
                 * Для товаров [определенных категорий и торговых марок](https://yastatic.net/s3/doc-binary/src/support/market/ru/yandex-market-list-for-gtin.xlsx) штрихкод должен быть действительным кодом GTIN. Обратите внимание: внутренние штрихкоды, начинающиеся на 2 или 02, и коды формата Code 128 не являются GTIN.
                 *
                 * [Что такое GTIN](*gtin)
                 *
                 *
                 */
                barcodes?: Array<string> | null;
                /**
                 * Подробное описание товара: например, его преимущества и особенности.
                 *
                 * Не давайте в описании инструкций по установке и сборке. Не используйте слова «скидка», «распродажа», «дешевый», «подарок» (кроме подарочных категорий), «бесплатно», «акция», «специальная цена», «новинка», «new», «аналог», «заказ», «хит». Не указывайте никакой контактной информации и не давайте ссылок.
                 *
                 * Можно использовать теги:
                 *
                 * * \<h>, \<h1>, \<h2> и так далее — для заголовков;
                 * * \<br> и \<p> — для переноса строки;
                 * * \<ol> — для нумерованного списка;
                 * * \<ul> — для маркированного списка;
                 * * \<li> — для создания элементов списка (должен находиться внутри \<ol> или \<ul>);
                 * * \<div> — поддерживается, но не влияет на отображение текста.
                 *
                 * Оптимальная длина — 400–600 символов.
                 *
                 * [Рекомендации и правила](https://yandex.ru/support/marketplace/assortment/fields/description.html)
                 *
                 */
                description?: string;
                /**
                 * Артикул товара от производителя.
                 */
                vendorCode?: string;
                /**
                 * Цена на товар.
                 *
                 */
                basicPrice?: paths_1businesses_1_businessId_1offer_prices_1updates_post_requestBody_content_application_1json_schema_properties_offers_items_properties_price_allOf_0_allOf_0;
            }> | null;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/offer-mappings/suggestions',
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
     * Добавление товаров в архив
     * {% include notitle [access](../../_auto/method_scopes/addOffersToArchive.md) %}
     *
     * Помещает товары в архив. Товары, помещенные в архив, скрыты с витрины во всех магазинах кабинета.
     *
     * {% note warning "В архив нельзя отправить товар, который хранится на складе Маркета" %}
     *
     * Вначале такой товар нужно распродать или вывезти.
     *
     * {% endnote %}
     *
     * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 200 товаров в одном запросе|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Если некоторые товары добавить в архив не удалось, в ответе 200 будет их список.
     *
     * Список успешно добавленных товаров не возвращается.
     *
     * @throws ApiError
     */
    public static addOffersToArchive(
        businessId: number,
        requestBody: {
            /**
             * Список товаров, которые нужно поместить в архив.
             */
            offerIds: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/offer-mappings/archive',
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
                423: `К ресурсу нельзя применить указанный метод.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
    /**
     * Удаление товаров из архива
     * {% include notitle [access](../../_auto/method_scopes/deleteOffersFromArchive.md) %}
     *
     * Восстанавливает товары из архива.
     *
     * |**⚙️ Лимит:** 10 000 товаров в минуту, не более 200 товаров в одном запросе|
     * |-|
     *
     * @param businessId Идентификатор кабинета. Чтобы его узнать, воспользуйтесь запросом [GET campaigns](../../reference/campaigns/getCampaigns.md).
     *
     * ℹ️ [Что такое кабинет и магазин на Маркете](https://yandex.ru/support/marketplace/account/introduction.html)
     *
     * @param requestBody
     * @returns any Если некоторые товары восстановить из архива не удалось, в ответе 200 будет их список.
     *
     * Список успешно восстановленных товаров не возвращается.
     *
     * @throws ApiError
     */
    public static deleteOffersFromArchive(
        businessId: number,
        requestBody: {
            /**
             * Список товаров, которые нужно восстановить из архива.
             */
            offerIds: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items>;
        },
    ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/businesses/{businessId}/offer-mappings/unarchive',
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
                423: `К ресурсу нельзя применить указанный метод.`,
                500: `Внутренняя ошибка сервера.`,
            },
        });
    }
}
