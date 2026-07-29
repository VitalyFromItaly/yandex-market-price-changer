/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema } from '../models/paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema';
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_1buyer_get_responses_200_content_application_1json_schema_allOf_1_properties_result_allOf_0 } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_1buyer_get_responses_200_content_application_1json_schema_allOf_1_properties_result_allOf_0';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_1items_put_requestBody_content_application_1json_schema_properties_items_items_properties_instances_items } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_1items_put_requestBody_content_application_1json_schema_properties_items_items_properties_instances_items';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_delivery_properties_tracks_items } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_delivery_properties_tracks_items';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_delivery_properties_vat } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_delivery_properties_vat';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate';
import type { paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_updatedAt } from '../models/paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_updatedAt';
import type { paths_1campaigns_1_campaignId_1orders_get_parameters_10_schema } from '../models/paths_1campaigns_1_campaignId_1orders_get_parameters_10_schema';
import type { paths_1campaigns_1_campaignId_1orders_get_parameters_2_schema_items } from '../models/paths_1campaigns_1_campaignId_1orders_get_parameters_2_schema_items';
import type { paths_1campaigns_1_campaignId_1orders_get_parameters_3_schema_items } from '../models/paths_1campaigns_1_campaignId_1orders_get_parameters_3_schema_items';
import type { paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging_allOf_0 } from '../models/paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging_allOf_0';
import type { paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager } from '../models/paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager';
import type { paths_1models_get_parameters_2_schema } from '../models/paths_1models_get_parameters_2_schema';
import type { paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions } from '../models/paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions';
import type { paths_1regions_1countries_post_responses_200_content_application_1json_schema_properties_countries_items_properties_countryCode } from '../models/paths_1regions_1countries_post_responses_200_content_application_1json_schema_properties_countries_items_properties_countryCode';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_1_properties_result_properties_warehouses_items_properties_address_properties_gps } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_1_properties_result_properties_warehouses_items_properties_address_properties_gps';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class OrdersService {
  /**
   * Информация об одном заказе
   * {% include notitle [access](../../_auto/method_scopes/getOrder.md) %}
   *
   * Возвращает информацию о заказе.
   *
   * {% note tip "Вы также можете настроить API-уведомления" %}
   *
   * Маркет отправит вам [запрос](../../push-notifications/reference/sendNotification.md), когда появится новый заказ или изменится его статус. А полную информацию можно получить с помощью этого метода или [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md).
   *
   * [{#T}](../../push-notifications/index.md)
   *
   * {% endnote %}
   *
   * Получить более подробную информацию о покупателе и его номере телефона можно с помощью запроса [GET campaigns/{campaignId}/orders/{orderId}/buyer](../../reference/orders/getOrderBuyerInfo.md).
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
   * @param orderId Идентификатор заказа.
   * @returns any Информация о заказе.
   * @throws ApiError
   */
  public static getOrder(
    campaignId: number,
    orderId: number,
  ): CancelablePromise<{
    /**
     * Заказ.
     */
    order?: {
      /**
       * Идентификатор заказа.
       */
      id: number;
      status: paths_1campaigns_1_campaignId_1orders_get_parameters_2_schema_items;
      substatus: paths_1campaigns_1_campaignId_1orders_get_parameters_3_schema_items;
      /**
       * Дата и время оформления заказа.
       *
       * Формат даты и времени: `ДД-ММ-ГГГГ ЧЧ:ММ:СС`. Часовой пояс — UTC+03:00 (Москва).
       *
       */
      creationDate: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_updatedAt;
      /**
       * Дата и время последнего обновления заказа.
       *
       * Формат даты и времени: `ДД-ММ-ГГГГ ЧЧ:ММ:СС`. Часовой пояс — UTC+03:00 (Москва).
       *
       */
      updatedAt?: string;
      /**
       * Валюта, в которой указаны цены на товары в заказе.
       *
       */
      currency: paths_1models_get_parameters_2_schema;
      /**
       * Платеж покупателя.
       *
       */
      itemsTotal: number;
      /**
       * Стоимость доставки.
       *
       */
      deliveryTotal: number;
      /**
       * Стоимость всех товаров в заказе в валюте покупателя после применения скидок и без учета стоимости доставки.
       * @deprecated
       */
      buyerItemsTotal?: number;
      /**
       * Стоимость всех товаров в заказе в валюте покупателя после применения скидок и с учетом стоимости доставки.
       * @deprecated
       */
      buyerTotal?: number;
      /**
       * Стоимость всех товаров в заказе в валюте покупателя без учета стоимости доставки и до применения скидок по:
       *
       * * акциям;
       * * купонам;
       * * промокодам.
       *
       */
      buyerItemsTotalBeforeDiscount: number;
      /**
       * Стоимость всех товаров в заказе в валюте покупателя до применения скидок и с учетом стоимости доставки (`buyerItemsTotalBeforeDiscount` + стоимость доставки).
       * @deprecated
       */
      buyerTotalBeforeDiscount?: number;
      /**
       * Тип оплаты заказа:
       *
       * * `PREPAID` — оплата при оформлении заказа.
       *
       * * `POSTPAID` — оплата при получении заказа.
       *
       * * `UNKNOWN` — неизвестный тип.
       *
       * Если параметр отсутствует, заказ будет оплачен при получении.
       *
       */
      paymentType: 'PREPAID' | 'POSTPAID' | 'UNKNOWN';
      /**
       * Способ оплаты заказа:
       *
       * * Значения, если выбрана оплата при оформлении заказа (`"paymentType": "PREPAID"`):
       *
       * * `YANDEX` — банковской картой.
       *
       * * `YA_PLUS_POINTS` — баллами Яндекс Плюс.
       *
       * * `APPLE_PAY` — Apple Pay.
       *
       * * `GOOGLE_PAY` — Google Pay.
       *
       * * `CREDIT` — в кредит.
       *
       * * `TINKOFF_CREDIT` — в кредит в Тинькофф Банке.
       *
       * * `TINKOFF_INSTALLMENTS` — рассрочка в Тинькофф Банке.
       *
       * * `EXTERNAL_CERTIFICATE` — подарочным сертификатом (например, из приложения «Сбербанк Онлайн»).
       *
       * * `SBP` — через систему быстрых платежей.
       *
       * * `B2B_ACCOUNT_PREPAYMENT` — заказ оплачивает организация.
       *
       *
       * * Значения, если выбрана оплата при получении заказа (`"paymentType": "POSTPAID"`):
       *
       * * `CARD_ON_DELIVERY` — банковской картой.
       *
       * * `BOUND_CARD_ON_DELIVERY` — привязанной картой при получении.
       *
       * * `BNPL_BANK_ON_DELIVERY` — супер Сплитом.
       *
       * * `BNPL_ON_DELIVERY` — Сплитом.
       *
       * * `CASH_ON_DELIVERY` — наличными.
       *
       * * `B2B_ACCOUNT_POSTPAYMENT` — заказ оплачивает организация после доставки.
       *
       * * `UNKNOWN` — неизвестный тип.
       *
       * Значение по умолчанию: `CASH_ON_DELIVERY`.
       *
       */
      paymentMethod:
        | 'CASH_ON_DELIVERY'
        | 'CARD_ON_DELIVERY'
        | 'BOUND_CARD_ON_DELIVERY'
        | 'BNPL_BANK_ON_DELIVERY'
        | 'BNPL_ON_DELIVERY'
        | 'YANDEX'
        | 'YA_PLUS_POINTS'
        | 'APPLE_PAY'
        | 'EXTERNAL_CERTIFICATE'
        | 'CREDIT'
        | 'GOOGLE_PAY'
        | 'TINKOFF_CREDIT'
        | 'SBP'
        | 'TINKOFF_INSTALLMENTS'
        | 'B2B_ACCOUNT_PREPAYMENT'
        | 'B2B_ACCOUNT_POSTPAYMENT'
        | 'UNKNOWN';
      /**
       * Тип заказа:
       *
       * * `false` — настоящий заказ покупателя.
       *
       * * `true` — [тестовый](../../concepts/sandbox.md) заказ Маркета.
       *
       */
      fake: boolean;
      /**
       * Список товаров в заказе.
       */
      items: Array<{
        /**
         * Идентификатор товара в заказе.
         *
         * Позволяет идентифицировать товар в рамках данного заказа.
         *
         */
        id: number;
        /**
         * Идентификатор вашего товарного предложения для определенного товара. [Описание поля в Справке Маркета для продавцов](https://yandex.ru/support/marketplace/assortment/fields/index.html#sku)
         */
        offerId: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * Название товара.
         */
        offerName: string;
        /**
         * Цена на товар в валюте заказа без учета вознаграждения партнеру за скидки по промокодам, купонам и акциям (параметр `subsidies`).
         *
         */
        price: number;
        /**
         * Цена на товар в валюте покупателя. В цене уже учтены скидки по:
         *
         * * акциям;
         * * купонам;
         * * промокодам.
         *
         */
        buyerPrice: number;
        /**
         * Стоимость товара в валюте покупателя до применения скидок по:
         *
         * * акциям;
         * * купонам;
         * * промокодам.
         *
         */
        buyerPriceBeforeDiscount: number;
        /**
         * Стоимость товара в валюте магазина до применения скидок.
         * @deprecated
         */
        priceBeforeDiscount?: number;
        /**
         * Количество единиц товара.
         */
        count: number;
        /**
         * Налог на добавленную стоимость (НДС) на товар.
         */
        vat: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_delivery_properties_vat;
        /**
         * {% note warning "Вместо него используйте `offerId`." %}
         *
         *
         *
         * {% endnote %}
         *
         * Ваш SKU — идентификатор товара в вашей системе.
         *
         * @deprecated
         */
        shopSku?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
        /**
         * {% note warning "Вместо него используйте `subsidies`." %}
         *
         *
         *
         * {% endnote %}
         *
         * Общее вознаграждение партнеру за DBS-доставку и все скидки на товар:
         *
         * * по промокодам;
         * * по купонам;
         * * по баллам Плюса;
         * * по акциям.
         *
         * @deprecated
         */
        subsidy?: number;
        /**
         * Идентификатор склада в системе партнера, на который сформирован заказ.
         * @deprecated
         */
        partnerWarehouseId?: string;
        /**
         * Информация о вознаграждениях партнеру за скидки на товар по промокодам, купонам и акциям.
         */
        promos?: Array<{
          /**
           * Тип скидки.
           *
           */
          type:
            | 'DIRECT_DISCOUNT'
            | 'BLUE_SET'
            | 'BLUE_FLASH'
            | 'GENERIC_BUNDLE'
            | 'MARKET_COUPON'
            | 'MARKET_PROMOCODE'
            | 'MARKET_BLUE'
            | 'MARKET_COIN'
            | 'PRICE_DROP_AS_YOU_SHOP'
            | 'SECRET_SALE'
            | 'CHEAPEST_AS_GIFT'
            | 'CASHBACK'
            | 'SPREAD_DISCOUNT_COUNT'
            | 'SPREAD_DISCOUNT_RECEIPT'
            | 'DISCOUNT_BY_PAYMENT_TYPE'
            | 'PERCENT_DISCOUNT'
            | 'DCO_EXTRA_DISCOUNT'
            | 'UNKNOWN';
          /**
           * Размер пользовательской скидки в валюте покупателя.
           *
           */
          discount?: number;
          /**
           * Вознаграждение партнеру от Маркета за товар, проданный в рамках акции.
           *
           */
          subsidy: number;
          /**
           * Идентификатор акции поставщика.
           *
           */
          shopPromoId?: string;
          /**
           * Идентификатор акции в рамках соглашения на оказание услуг по продвижению сервиса между Маркетом и партнером.
           *
           */
          marketPromoId?: string;
        }> | null;
        /**
         * Информация о маркировке единиц товара.
         *
         * Возвращаются данные для маркировки, переданные в запросе [PUT campaigns/{campaignId}/orders/{orderId}/identifiers](../../reference/orders/provideOrderItemIdentifiers.md).
         *
         * Если магазин еще не передавал коды для этого заказа, `instances` отсутствует.
         *
         */
        instances?: Array<{
          /**
           * Код идентификации единицы товара в системе [«Честный ЗНАК»](https://честныйзнак.рф/) без криптохвоста или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go).
           */
          cis?: string;
          /**
           * Код идентификации единицы товара в системе [«Честный ЗНАК»](https://честныйзнак.рф/) с криптохвостом.
           */
          cisFull?: string;
          /**
           * УИН ювелирного изделия (16-значный код)
           * Производитель получает УИН, когда регистрирует изделие в системе контроля за оборотом драгоценных металлов и камней — ГИИС ДМДК.
           *
           */
          uin?: string;
          /**
           * Регистрационный номер партии товара.
           *
           * Представляет собой строку из четырех чисел, разделенных косой чертой: ХХХХХХХХ/ХХХХХХ/ХХХХХХХ/ХХХ.
           *
           * Первая часть — код таможни, которая зарегистрировала декларацию на партию товара. Далее — дата, номер декларации и номер маркированного товара в декларации.
           *
           */
          rnpt?: string;
          /**
           * Грузовая таможенная декларация.
           *
           * Представляет собой строку из трех чисел, разделенных косой чертой: ХХХХХХХХ/ХХХХХХ/ХХХХХХХ.
           *
           * Первая часть — код таможни, которая зарегистрировала декларацию на ввезенные товары. Далее — дата и номер декларации.
           *
           */
          gtd?: string;
          countryCode?: paths_1regions_1countries_post_responses_200_content_application_1json_schema_properties_countries_items_properties_countryCode;
        }> | null;
        /**
         * {% note warning "Для получения информации о невыкупах и возвратах используйте [GET campaigns/{campaignId}/returns](../../reference/orders/getReturns.md)." %}
         *
         *
         *
         * {% endnote %}
         *
         * Информация о невыкупленных или возвращенных товарах в заказе.
         *
         * @deprecated
         */
        details?: Array<{
          /**
           * Количество единиц товара.
           */
          itemCount: number;
          /**
           * Невыкупленный или возвращенный товар:
           *
           * * `REJECTED` — невыкупленный.
           *
           * * `RETURNED` — возвращенный.
           *
           */
          itemStatus: 'REJECTED' | 'RETURNED';
          /**
           * Формат даты: `ДД-ММ-ГГГГ`.
           *
           */
          updateDate: string;
        }> | null;
        /**
         * Список субсидий по типам.
         */
        subsidies?: Array<{
          /**
           * Тип субсидии:
           *
           * * `YANDEX_CASHBACK` — скидка по подписке Яндекс Плюс.
           *
           * * `SUBSIDY` — скидка Маркета (по акциям, промокодам, купонам и т. д.).
           *
           */
          type: 'YANDEX_CASHBACK' | 'SUBSIDY';
          /**
           * Сумма субсидии.
           */
          amount: number;
        }> | null;
        /**
         * Список необходимых маркировок товара.
         */
        requiredInstanceTypes?: Array<'CIS' | 'CIS_OPTIONAL' | 'UIN' | 'RNPT' | 'GTD'> | null;
        /**
         * Признаки товара.
         */
        tags?: Array<'ULTIMA' | 'SAFE_TAG' | 'TURBO'> | null;
      }>;
      /**
       * Список субсидий по типам.
       */
      subsidies?: Array<{
        /**
         * Тип субсидии:
         *
         * * `YANDEX_CASHBACK` — скидка по подписке Яндекс Плюс.
         *
         * * `SUBSIDY` — скидка Маркета (по акциям, промокодам, купонам и т. д.)
         *
         * * `DELIVERY` — скидка за доставку (DBS).
         *
         */
        type: 'YANDEX_CASHBACK' | 'SUBSIDY' | 'DELIVERY';
        /**
         * Сумма субсидии.
         */
        amount: number;
      }> | null;
      /**
       * Информация о доставке.
       */
      delivery: {
        /**
         * Идентификатор доставки, присвоенный магазином.
         *
         * Указывается, только если магазин передал данный идентификатор в ответе на запрос методом `POST cart`.
         *
         * @deprecated
         */
        id?: string;
        /**
         * Способ доставки заказа.
         *
         */
        type: 'DELIVERY' | 'PICKUP' | 'POST' | 'DIGITAL' | 'UNKNOWN';
        /**
         * Наименование службы доставки.
         */
        serviceName: string;
        /**
         * {% note warning "Стоимость доставки смотрите в параметре `deliveryTotal`." %}
         *
         *
         *
         * {% endnote %}
         *
         * Стоимость доставки в валюте заказа.
         *
         * @deprecated
         */
        price?: number;
        /**
         * Тип сотрудничества со службой доставки в рамках конкретного заказа.
         */
        deliveryPartnerType: 'SHOP' | 'YANDEX_MARKET' | 'UNKNOWN';
        /**
         * Информация о курьере.
         */
        courier?: {
          /**
           * Полное имя курьера.
           */
          fullName?: string;
          /**
           * Номер телефона курьера.
           */
          phone?: string;
          /**
           * Добавочный номер телефона.
           */
          phoneExtension?: string;
          /**
           * Номер транспортного средства.
           */
          vehicleNumber?: string;
          /**
           * Описание машины. Например, модель и цвет.
           */
          vehicleDescription?: string;
        };
        /**
         * Диапазон дат доставки.
         */
        dates: {
          /**
           * Ближайшая дата доставки.
           *
           * Формат даты: `ДД-ММ-ГГГГ`.
           *
           */
          fromDate: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
          /**
           * Самая поздняя дата доставки.
           *
           * Если параметр `toDate` не указан, единственно возможной датой доставки считается дата, указанная в параметре `fromDate`.
           *
           * Формат даты: `ДД-ММ-ГГГГ`.
           *
           */
          toDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
          /**
           * Начало интервала времени доставки.
           *
           * Передается только совместно с параметром `type=DELIVERY`.
           *
           * Формат времени: 24-часовой, `ЧЧ:ММ`. В качестве минут всегда должно быть указано `00` (исключение — `23:59`).
           *
           * Минимальное значение: `00:00`.
           *
           */
          fromTime?: string;
          /**
           * Конец интервала времени доставки.
           *
           * Передается только совместно с параметром `type=DELIVERY`.
           *
           * Формат времени: 24-часовой, `ЧЧ:ММ`. В качестве минут всегда должно быть указано `00` (исключение — `23:59`).
           *
           * Максимальное значение: `23:59`.
           *
           */
          toTime?: string;
          /**
           * Дата, когда товар доставлен до пункта выдачи заказа (в случае самовывоза) или до покупателя (если заказ доставляет курьер).
           */
          realDeliveryDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
        };
        region?: paths_1regions_1_regionId_1children_get_responses_200_content_application_1json_schema_properties_regions;
        /**
         * Адрес доставки.
         *
         * Указывается, если параметр `type` принимает значение `DELIVERY`, `POST` или `PICKUP` (только для модели DBS). Если `type=PICKUP`, возвращается адрес пункта выдачи.
         *
         */
        address?: {
          /**
           * Страна.
           *
           */
          country?: string;
          /**
           * Почтовый индекс.
           *
           * Указывается, если выбрана доставка почтой (`delivery type=POST`).
           *
           */
          postcode?: string;
          /**
           * Город или населенный пункт.
           *
           */
          city?: string;
          /**
           * Район.
           */
          district?: string;
          /**
           * Станция метро.
           */
          subway?: string;
          /**
           * Улица.
           *
           */
          street?: string;
          /**
           * Дом или владение.
           *
           */
          house?: string;
          /**
           * Корпус или строение.
           */
          block?: string;
          /**
           * Подъезд.
           */
          entrance?: string;
          /**
           * Код домофона.
           */
          entryphone?: string;
          /**
           * Этаж.
           */
          floor?: string;
          /**
           * Квартира или офис.
           */
          apartment?: string;
          /**
           * Телефон получателя заказа.
           *
           */
          phone?: string;
          /**
           * Фамилия, имя и отчество получателя заказа.
           *
           */
          recipient?: string;
          /**
           * GPS-координаты.
           */
          gps?: paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_1_properties_result_properties_warehouses_items_properties_address_properties_gps;
        };
        /**
         * Налог на добавленную стоимость (НДС) на товар:
         *
         * * `NO_VAT` — НДС не облагается, используется только для отдельных видов услуг.
         *
         * * `VAT_0` — НДС 0%. Например, используется при продаже товаров, вывезенных в таможенной процедуре экспорта, или при оказании услуг по международной перевозке товаров.
         *
         * * `VAT_10` — НДС 10%. Например, используется при реализации отдельных продовольственных и медицинских товаров.
         *
         * * `VAT_10_110` — НДС 10/110. НДС 10%, применяется только при предоплате.
         *
         * * `VAT_20` — НДС 20%. Основной НДС с 2019 года.
         *
         * * `VAT_20_120` — НДС 20/120. НДС 20%, применяется только при предоплате.
         *
         * * `VAT_18` — НДС 18%. Основной НДС до 2019 года.
         *
         * * `VAT_18_118` — НДС 18/118. НДС использовался до 1 января 2019 года при предоплате.
         *
         * * `VAT_12` — НДС 12%. Используется только в Узбекистане.
         *
         * * `VAT_05` — НДС 5%. НДС для упрощенной системы налогообложения (УСН).
         *
         * * `VAT_07` — НДС 7%. НДС для упрощенной системы налогообложения (УСН).
         *
         * * `UNKNOWN_VALUE` — неизвестный тип.
         *
         * Используется только совместно с параметром `payment-method=YANDEX`.
         *
         */
        vat?:
          | 'NO_VAT'
          | 'VAT_0'
          | 'VAT_10'
          | 'VAT_10_110'
          | 'VAT_20'
          | 'VAT_20_120'
          | 'VAT_18'
          | 'VAT_18_118'
          | 'VAT_12'
          | 'VAT_05'
          | 'VAT_07'
          | 'UNKNOWN_VALUE';
        /**
         * Идентификатор службы доставки.
         */
        deliveryServiceId: number;
        /**
         * Тип подъема заказа на этаж:
         *
         * * `NOT_NEEDED` — не требуется.
         *
         * * `MANUAL` — ручной.
         *
         * * `ELEVATOR` — лифт.
         *
         * * `CARGO_ELEVATOR` — грузовой лифт.
         *
         * * `FREE` — любой из перечисленных выше, если включена опция бесплатного подъема.
         *
         * * `UNKNOWN` — неизвестный тип.
         *
         */
        liftType?: 'NOT_NEEDED' | 'MANUAL' | 'ELEVATOR' | 'CARGO_ELEVATOR' | 'FREE' | 'UNKNOWN';
        /**
         * Стоимость подъема на этаж.
         */
        liftPrice?: number;
        /**
         * Идентификатор пункта самовывоза, присвоенный магазином.
         */
        outletCode?: string;
        /**
         * Дата, до которой заказ будет храниться в пункте выдачи. Возвращается, когда заказ переходит в статус `PICKUP`.
         *
         * Один раз дату можно поменять с помощью метода [PUT campaigns/{campaignId}/orders/{orderId}/delivery/storage-limit](../../reference/orders/updateOrderStorageLimit.md).
         *
         */
        outletStorageLimitDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
        dispatchType?: paths_1campaigns_1_campaignId_1orders_get_parameters_10_schema;
        /**
         * Информация для отслеживания перемещений посылки.
         */
        tracks?: Array<{
          /**
           * Трек‑номер посылки.
           */
          trackCode?: string;
          /**
           * Идентификатор службы доставки. Информацию о службе доставки можно получить с помощью запроса [GET delivery/services](../../reference/orders/getDeliveryServices.md).
           */
          deliveryServiceId: number;
        }> | null;
        /**
         * Информация о посылках.
         */
        shipments?: Array<{
          /**
           * Идентификатор посылки, присвоенный Маркетом.
           */
          id?: number;
          /**
           * День, в который нужно отгрузить заказ службе доставки.
           *
           * Формат даты: `ДД-ММ-ГГГГ`.
           *
           * Если заказ сделан организацией, параметр не возвращается до согласования даты доставки.
           *
           * {% cut "Иногда Маркет может перенести дату отгрузки" %}
           *
           * У таких заказов обновится параметр `updatedAt`. Чтобы найти их, в запросе [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) укажите параметры `updatedAtFrom` и `updatedAtTo`.
           *
           * {% endcut %}
           *
           *
           *
           */
          shipmentDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_items_items_properties_details_items_properties_updateDate;
          /**
           * **Только для модели Экспресс**
           *
           * Время, к которому магазин должен упаковать заказ и перевести его в статус `READY_TO_SHIP`. После смены статуса за заказом приедет курьер.
           *
           * Поле может появиться не сразу. Запрашивайте информацию о заказе в течении 5–10 минут, пока оно не вернется.
           *
           * Формат времени: 24-часовой, `ЧЧ:ММ`.
           *
           * Если заказ сделан организацией, параметр не возвращается до согласования даты доставки.
           *
           */
          shipmentTime?: string;
          /**
           * **Только для модели DBS**
           *
           * Информация для отслеживания перемещений посылки.
           *
           */
          tracks?: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_delivery_properties_tracks_items> | null;
          /**
           * Список грузовых мест.
           */
          boxes?: Array<{
            /**
             * Идентификатор грузоместа.
             */
            id: number;
            /**
             * Идентификатор грузового места в информационной системе магазина.
             */
            fulfilmentId: string;
          }> | null;
        }> | null;
        /**
         * Приблизительная ли дата доставки.
         */
        estimated?: boolean;
        /**
         * Тип кода подтверждения ЭАПП.
         */
        eacType?: 'MERCHANT_TO_COURIER' | 'COURIER_TO_MERCHANT' | 'CHECKING_BY_MERCHANT';
        /**
         * Код подтверждения ЭАПП (для типа `MERCHANT_TO_COURIER`).
         *
         */
        eacCode?: string;
      };
      /**
       * Информация о покупателе.
       *
       * Параметры `id`, `lastName`, `firstName` и `middleName` возвращаются, только если вы работаете по модели DBS.
       *
       */
      buyer: paths_1campaigns_1_campaignId_1orders_1_orderId_1buyer_get_responses_200_content_application_1json_schema_allOf_1_properties_result_allOf_0;
      /**
       * Комментарий к заказу.
       */
      notes?: string;
      /**
       * Система налогообложения (СНО) магазина на момент оформления заказа:
       *
       * * `ECHN` — единый сельскохозяйственный налог (ЕСХН).
       *
       * * `ENVD` — единый налог на вмененный доход (ЕНВД).
       *
       * * `OSN` — общая система налогообложения (ОСН).
       *
       * * `PSN` — патентная система налогообложения (ПСН).
       *
       * * `USN` — упрощенная система налогообложения (УСН).
       *
       * * `USN_MINUS_COST` — упрощенная система налогообложения, доходы, уменьшенные на величину расходов (УСН «Доходы минус расходы»).
       *
       * * `NPD` — налог на профессиональный доход (НПД).
       *
       * * `UNKNOWN_VALUE` — неизвестное значение.
       * Используется только совместно с параметром `payment-method=YANDEX`.
       *
       */
      taxSystem:
        | 'OSN'
        | 'USN'
        | 'USN_MINUS_COST'
        | 'ENVD'
        | 'ECHN'
        | 'PSN'
        | 'NPD'
        | 'UNKNOWN_VALUE';
      /**
       * **Только для модели DBS**
       *
       * Запрошена ли отмена.
       *
       */
      cancelRequested?: boolean;
      /**
       * Дата, после которой заказ будет отменен, если не сменит статус.
       *
       * Формат даты: `ДД-ММ-ГГГГ`.
       *
       */
      expiryDate?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order_properties_updatedAt;
    };
  }> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders/{orderId}',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Информация о нескольких заказах
   * {% include notitle [access](../../_auto/method_scopes/getOrders.md) %}
   *
   * Возвращает информацию о заказах. Запрос можно использовать, чтобы узнать, нет ли новых заказов.
   *
   * {% note tip "Вы также можете настроить API-уведомления" %}
   *
   * Маркет отправит вам [запрос](../../push-notifications/reference/sendNotification.md), когда появится новый заказ или изменится его статус. А полную информацию можно получить с помощью этого метода или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).
   *
   * [{#T}](../../push-notifications/index.md)
   *
   * {% endnote %}
   *
   * Доступна фильтрация по нескольким характеристикам заказов:
   *
   * * дате оформления;
   *
   * * статусу;
   *
   * * идентификаторам заказов;
   *
   * * этапу обработки или причине отмены;
   *
   * * типу (настоящий или тестовый);
   *
   * * дате отгрузки в службу доставки;
   *
   * * дате и времени обновления заказа.
   *
   * Информация о заказах, доставленных или отмененных больше 30 дней назад, не возвращается. Ее можно получить с помощью запроса информации об отдельном заказе [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md) (если у вас есть идентификатор заказа) или запроса отчета по заказам [POST campaigns/{campaignId}/stats/orders](../../reference/stats/getOrdersStats.md).
   *
   * Максимальный диапазон дат за один запрос к ресурсу — 30 дней.
   *
   * Результаты возвращаются постранично. Для навигации по страницам используйте параметры `page_token` и `limit`.
   *
   * Получить более подробную информацию о покупателе и его номере телефона можно с помощью запроса [GET campaigns/{campaignId}/orders/{orderId}/buyer](../../reference/orders/getOrderBuyerInfo.md).
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
   * @param orderIds Фильтрация заказов по идентификаторам.
   * <br><br>
   * ⚠️ Не используйте это поле одновременно с другими фильтрами. Если вы хотите воспользоваться ими, оставьте поле пустым.
   *
   * @param status Статус заказа:
   *
   * * `CANCELLED` — заказ отменен.
   *
   * * `DELIVERED` — заказ получен покупателем.
   *
   * * `DELIVERY` — заказ передан в службу доставки.
   *
   * * `PICKUP` — заказ доставлен в пункт самовывоза.
   *
   * * `PROCESSING` — заказ находится в обработке.
   *
   * * `UNPAID` — заказ оформлен, но еще не оплачен (если выбрана оплата при оформлении).
   *
   * Также могут возвращаться другие значения. Обрабатывать их не требуется.
   *
   * @param substatus Этап обработки заказа (если он имеет статус `PROCESSING`) или причина отмены заказа (если он имеет статус `CANCELLED`).
   *
   * Возможные значения для заказа в статусе `PROCESSING`:
   *
   * * `STARTED` — заказ подтвержден, его можно начать обрабатывать.
   * * `READY_TO_SHIP` — заказ собран и готов к отправке.
   * * `SHIPPED` — заказ передан службе доставки.
   *
   * Возможные значения для заказа в статусе `CANCELLED`:
   *
   * * `RESERVATION_EXPIRED` — покупатель не завершил оформление зарезервированного заказа в течение 10 минут.
   *
   * * `USER_NOT_PAID` — покупатель не оплатил заказ (для типа оплаты `PREPAID`) в течение 30 минут.
   *
   * * `USER_UNREACHABLE` — не удалось связаться с покупателем. Для отмены с этой причиной необходимо выполнить условия:
   *
   * * не менее 3 звонков с 8 до 21 в часовом поясе покупателя;
   * * перерыв между первым и третьим звонком не менее 90 минут;
   * * соединение не короче 5 секунд.
   *
   * Если хотя бы одно из этих условий не выполнено (кроме случая, когда номер недоступен), отменить заказ не получится. Вернется ответ с кодом ошибки 400
   *
   * * `USER_CHANGED_MIND` — покупатель отменил заказ по личным причинам.
   *
   * * `USER_REFUSED_DELIVERY` — покупателя не устроили условия доставки.
   *
   * * `USER_REFUSED_PRODUCT` — покупателю не подошел товар.
   *
   * * `SHOP_FAILED` — магазин не может выполнить заказ.
   *
   * * `USER_REFUSED_QUALITY` — покупателя не устроило качество товара.
   *
   * * `REPLACING_ORDER` — покупатель решил заменить товар другим по собственной инициативе.
   *
   * * `PROCESSING_EXPIRED` — значение более не используется.
   *
   * * `PICKUP_EXPIRED` — закончился срок хранения заказа в ПВЗ.
   *
   * * `DELIVERY_SERVICE_UNDELIVERED` — служба доставки не смогла доставить заказ.
   *
   * * `CANCELLED_COURIER_NOT_FOUND` — не удалось найти курьера.
   *
   * * `USER_WANTS_TO_CHANGE_DELIVERY_DATE` — покупатель хочет получить заказ в другой день.
   *
   * * `RESERVATION_FAILED` — Маркет не может продолжить дальнейшую обработку заказа.
   *
   * Также могут возвращаться другие значения. Обрабатывать их не требуется.
   *
   * @param fromDate Начальная дата для фильтрации заказов по дате оформления.
   *
   * Формат даты: `ДД-ММ-ГГГГ`.
   *
   * Между начальной и конечной датой (параметр `toDate`) должно быть не больше 30 дней.
   *
   * Значение по умолчанию: 30 дней назад от текущей даты.
   *
   * @param toDate Конечная дата для фильтрации заказов по дате оформления.
   *
   * Показываются заказы, созданные до 00:00 указанного дня.
   *
   * Формат даты: `ДД-ММ-ГГГГ`.
   *
   * Между начальной (параметр `fromDate`) и конечной датой должно быть не больше 30 дней.
   *
   * Значение по умолчанию: текущая дата.
   *
   * Если промежуток времени между `toDate` и `fromDate` меньше суток, то `toDate` равен `fromDate` + сутки.
   *
   * @param supplierShipmentDateFrom Начальная дата для фильтрации заказов по дате отгрузки в службу доставки (параметр `shipmentDate`).
   *
   * Формат даты: `ДД-ММ-ГГГГ`.
   *
   * Между начальной и конечной датой (параметр `supplierShipmentDateTo`) должно быть не больше 30 дней.
   *
   * Начальная дата включается в интервал для фильтрации.
   *
   * @param supplierShipmentDateTo Конечная дата для фильтрации заказов по дате отгрузки в службу доставки (параметр `shipmentDate`).
   *
   * Формат даты: `ДД-ММ-ГГГГ`.
   *
   * Между начальной (параметр `supplierShipmentDateFrom`) и конечной датой должно быть не больше 30 дней.
   *
   * Конечная дата не включается в интервал для фильтрации.
   *
   * Если промежуток времени между `supplierShipmentDateTo` и `supplierShipmentDateFrom` меньше суток, то `supplierShipmentDateTo` равен `supplierShipmentDateFrom` + сутки.
   *
   * @param updatedAtFrom Начальная дата для фильтрации заказов по дате и времени обновления (параметр `updatedAt`).
   *
   * Формат даты: ISO 8601 со смещением относительно UTC. Например, `2017-11-21T00:42:42+03:00`.
   *
   * Между начальной и конечной датой (параметр `updatedAtTo`) должно быть не больше 30 дней.
   *
   * Начальная дата включается в интервал для фильтрации.
   *
   * @param updatedAtTo Конечная дата для фильтрации заказов по дате и времени обновления (параметр `updatedAt`).
   *
   * Формат даты: ISO 8601 со смещением относительно UTC. Например, `2017-11-21T00:42:42+03:00`.
   *
   * Между начальной (параметр `updatedAtFrom`) и конечной датой должно быть не больше 30 дней.
   *
   * Конечная дата не включается в интервал для фильтрации.
   *
   * @param dispatchType Способ отгрузки
   * @param fake Фильтрация заказов по типам:
   *
   * * `false` — настоящий заказ покупателя.
   *
   * * `true` — [тестовый](../../concepts/sandbox.md) заказ Маркета.
   *
   * @param hasCis Нужно ли вернуть только те заказы, в составе которых есть хотя бы один товар с кодом идентификации в системе [«Честный ЗНАК»](https://честныйзнак.рф/) или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go):
   *
   * * `true` — да.
   *
   * * `false` — нет.
   *
   * Такие коды присваиваются товарам, которые подлежат маркировке и относятся к определенным категориям.
   *
   * @param onlyWaitingForCancellationApprove **Только для модели DBS**
   *
   * Фильтрация заказов по наличию запросов покупателей на отмену.
   *
   * При значение `true` возвращаются только заказы, которые находятся в статусе `DELIVERY` или `PICKUP` и которые пользователи решили отменить.
   *
   * Чтобы подтвердить или отклонить отмену, отправьте запрос [PUT campaigns/{campaignId}/orders/{orderId}/cancellation/accept](../../reference/orders/acceptOrderCancellation).
   *
   * @param onlyEstimatedDelivery Фильтрация заказов с долгой доставкой (31-60 дней) по подтвержденной дате доставки:
   *
   * * `true` — возвращаются только заказы с неподтвержденной датой доставки.
   * * `false` — фильтрация не применяется.
   *
   * @param buyerType Фильтрация заказов по типу покупателя.
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
   * @returns any Информация о заказах.
   * @throws ApiError
   */
  public static getOrders(
    campaignId: number,
    orderIds?: Array<number>,
    status?: Array<
      | 'PLACING'
      | 'RESERVED'
      | 'UNPAID'
      | 'PROCESSING'
      | 'DELIVERY'
      | 'PICKUP'
      | 'DELIVERED'
      | 'CANCELLED'
      | 'PENDING'
      | 'PARTIALLY_RETURNED'
      | 'RETURNED'
      | 'UNKNOWN'
    >,
    substatus?: Array<
      | 'RESERVATION_EXPIRED'
      | 'USER_NOT_PAID'
      | 'USER_UNREACHABLE'
      | 'USER_CHANGED_MIND'
      | 'USER_REFUSED_DELIVERY'
      | 'USER_REFUSED_PRODUCT'
      | 'SHOP_FAILED'
      | 'USER_REFUSED_QUALITY'
      | 'REPLACING_ORDER'
      | 'PROCESSING_EXPIRED'
      | 'PENDING_EXPIRED'
      | 'SHOP_PENDING_CANCELLED'
      | 'PENDING_CANCELLED'
      | 'USER_FRAUD'
      | 'RESERVATION_FAILED'
      | 'USER_PLACED_OTHER_ORDER'
      | 'USER_BOUGHT_CHEAPER'
      | 'MISSING_ITEM'
      | 'BROKEN_ITEM'
      | 'WRONG_ITEM'
      | 'PICKUP_EXPIRED'
      | 'DELIVERY_PROBLEMS'
      | 'LATE_CONTACT'
      | 'CUSTOM'
      | 'DELIVERY_SERVICE_FAILED'
      | 'WAREHOUSE_FAILED_TO_SHIP'
      | 'DELIVERY_SERIVCE_UNDELIVERED'
      | 'DELIVERY_SERVICE_UNDELIVERED'
      | 'PREORDER'
      | 'AWAIT_CONFIRMATION'
      | 'STARTED'
      | 'PACKAGING'
      | 'READY_TO_SHIP'
      | 'SHIPPED'
      | 'ASYNC_PROCESSING'
      | 'USER_REFUSED_TO_PROVIDE_PERSONAL_DATA'
      | 'WAITING_USER_INPUT'
      | 'WAITING_BANK_DECISION'
      | 'BANK_REJECT_CREDIT_OFFER'
      | 'CUSTOMER_REJECT_CREDIT_OFFER'
      | 'CREDIT_OFFER_FAILED'
      | 'AWAIT_DELIVERY_DATES_CONFIRMATION'
      | 'SERVICE_FAULT'
      | 'DELIVERY_SERVICE_RECEIVED'
      | 'USER_RECEIVED'
      | 'WAITING_FOR_STOCKS'
      | 'AS_PART_OF_MULTI_ORDER'
      | 'READY_FOR_LAST_MILE'
      | 'LAST_MILE_STARTED'
      | 'ANTIFRAUD'
      | 'DELIVERY_USER_NOT_RECEIVED'
      | 'DELIVERY_SERVICE_DELIVERED'
      | 'DELIVERED_USER_NOT_RECEIVED'
      | 'USER_WANTED_ANOTHER_PAYMENT_METHOD'
      | 'USER_RECEIVED_TECHNICAL_ERROR'
      | 'USER_FORGOT_TO_USE_BONUS'
      | 'RECEIVED_ON_DISTRIBUTION_CENTER'
      | 'DELIVERY_SERVICE_NOT_RECEIVED'
      | 'DELIVERY_SERVICE_LOST'
      | 'SHIPPED_TO_WRONG_DELIVERY_SERVICE'
      | 'DELIVERED_USER_RECEIVED'
      | 'WAITING_TINKOFF_DECISION'
      | 'COURIER_SEARCH'
      | 'COURIER_FOUND'
      | 'COURIER_IN_TRANSIT_TO_SENDER'
      | 'COURIER_ARRIVED_TO_SENDER'
      | 'COURIER_RECEIVED'
      | 'COURIER_NOT_FOUND'
      | 'COURIER_NOT_DELIVER_ORDER'
      | 'COURIER_RETURNS_ORDER'
      | 'COURIER_RETURNED_ORDER'
      | 'WAITING_USER_DELIVERY_INPUT'
      | 'PICKUP_SERVICE_RECEIVED'
      | 'PICKUP_USER_RECEIVED'
      | 'CANCELLED_COURIER_NOT_FOUND'
      | 'COURIER_NOT_COME_FOR_ORDER'
      | 'DELIVERY_NOT_MANAGED_REGION'
      | 'INCOMPLETE_CONTACT_INFORMATION'
      | 'INCOMPLETE_MULTI_ORDER'
      | 'INAPPROPRIATE_WEIGHT_SIZE'
      | 'TECHNICAL_ERROR'
      | 'SORTING_CENTER_LOST'
      | 'COURIER_SEARCH_NOT_STARTED'
      | 'LOST'
      | 'AWAIT_PAYMENT'
      | 'AWAIT_LAVKA_RESERVATION'
      | 'USER_WANTS_TO_CHANGE_ADDRESS'
      | 'FULL_NOT_RANSOM'
      | 'PRESCRIPTION_MISMATCH'
      | 'DROPOFF_LOST'
      | 'DROPOFF_CLOSED'
      | 'DELIVERY_TO_STORE_STARTED'
      | 'USER_WANTS_TO_CHANGE_DELIVERY_DATE'
      | 'WRONG_ITEM_DELIVERED'
      | 'DAMAGED_BOX'
      | 'AWAIT_DELIVERY_DATES'
      | 'LAST_MILE_COURIER_SEARCH'
      | 'PICKUP_POINT_CLOSED'
      | 'LEGAL_INFO_CHANGED'
      | 'USER_HAS_NO_TIME_TO_PICKUP_ORDER'
      | 'DELIVERY_CUSTOMS_ARRIVED'
      | 'DELIVERY_CUSTOMS_CLEARED'
      | 'FIRST_MILE_DELIVERY_SERVICE_RECEIVED'
      | 'AWAIT_AUTO_DELIVERY_DATES'
      | 'AWAIT_USER_PERSONAL_DATA'
      | 'NO_PERSONAL_DATA_EXPIRED'
      | 'CUSTOMS_PROBLEMS'
      | 'AWAIT_CASHIER'
      | 'WAITING_POSTPAID_BUDGET_RESERVATION'
      | 'AWAIT_SERVICEABLE_CONFIRMATION'
      | 'POSTPAID_BUDGET_RESERVATION_FAILED'
      | 'AWAIT_CUSTOM_PRICE_CONFIRMATION'
      | 'READY_FOR_PICKUP'
      | 'TOO_MANY_DELIVERY_DATE_CHANGES'
      | 'TOO_LONG_DELIVERY'
      | 'DEFERRED_PAYMENT'
      | 'UNKNOWN'
    >,
    fromDate?: string,
    toDate?: string,
    supplierShipmentDateFrom?: string,
    supplierShipmentDateTo?: string,
    updatedAtFrom?: string,
    updatedAtTo?: string,
    dispatchType?: 'UNKNOWN' | 'BUYER' | 'MARKET_BRANDED_OUTLET' | 'SHOP_OUTLET',
    fake: boolean = false,
    hasCis: boolean = false,
    onlyWaitingForCancellationApprove: boolean = false,
    onlyEstimatedDelivery: boolean = false,
    buyerType?: 'PERSON' | 'BUSINESS',
    page: number = 1,
    pageSize?: number,
    pageToken?: string,
    limit?: number,
  ): CancelablePromise<{
    pager?: paths_1campaigns_get_responses_200_content_application_1json_schema_properties_pager;
    /**
     * Модель заказа.
     *
     */
    orders: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order>;
    /**
     * Информация о страницах с результатами.
     */
    paging?: paths_1campaigns_1_campaignId_1outlets_get_responses_200_content_application_1json_schema_properties_paging_allOf_0;
  }> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/campaigns/{campaignId}/orders',
      path: {
        campaignId: campaignId,
      },
      query: {
        orderIds: orderIds,
        status: status,
        substatus: substatus,
        fromDate: fromDate,
        toDate: toDate,
        supplierShipmentDateFrom: supplierShipmentDateFrom,
        supplierShipmentDateTo: supplierShipmentDateTo,
        updatedAtFrom: updatedAtFrom,
        updatedAtTo: updatedAtTo,
        dispatchType: dispatchType,
        fake: fake,
        hasCis: hasCis,
        onlyWaitingForCancellationApprove: onlyWaitingForCancellationApprove,
        onlyEstimatedDelivery: onlyEstimatedDelivery,
        buyerType: buyerType,
        page: page,
        pageSize: pageSize,
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
   * Передача кодов маркировки единиц товара
   * {% include notitle [access](../../_auto/method_scopes/provideOrderItemIdentifiers.md) %}
   *
   * {% note warning "Если вы работаете по модели FBS" %}
   *
   * Используйте метод [PUT campaigns/{campaignId}/orders/{orderId}/boxes](../../reference/orders/setOrderBoxLayout.md).
   *
   * {% endnote %}
   *
   * Передает Маркету коды маркировки для единиц товара в указанном заказе.
   *
   * Маркировка товаров в системе [«Честный ЗНАК»](https://честныйзнак.рф/) **необязательна** для заказов от физических лиц, но **обязательна** для заказов от бизнеса.
   *
   * Принимаются коды следующих типов:
   *
   * * Коды в системе [«Честный ЗНАК»](https://честныйзнак.рф/) или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go).
   * * УИН для ювелирных изделий.
   * * РНПТ и ГТД для импортных прослеживаемых товаров.
   *
   * {% note warning "Прежде чем работать с этим методом" %}
   *
   * Обязательно прочтите [статью о работе с маркируемыми товарами](https://yandex.ru/support/marketplace/orders/cz.html).
   *
   * {% endnote %}
   *
   * Для каждой позиции в заказе, требующей маркировки, нужно передать список кодов — по одному для каждой единицы товара. Например, если в заказе две пары тапочек и одна пара туфель, получится список из двух кодов для первой позиции и список из одного кода для второй.
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns any Ответ `200` обозначает, что коды успешно записались. Ответ содержит краткие сведения о промаркированных товарах.
   * @throws ApiError
   */
  public static provideOrderItemIdentifiers(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Список позиций, требующих маркировки.
       *
       */
      items: Array<{
        /**
         * Идентификатор товара в заказе.
         *
         * Он приходит в ответе на запрос [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md) — параметр `id` в `items`.
         *
         */
        id: number;
        /**
         * Список кодов маркировки единиц товара.
         *
         */
        instances: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_1items_put_requestBody_content_application_1json_schema_properties_items_items_properties_instances_items>;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/identifiers',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Удаление товара из заказа или уменьшение числа единиц
   * {% include notitle [access](../../_auto/method_scopes/updateOrderItems.md) %}
   *
   * {% note warning "Если вы работаете по модели FBS" %}
   *
   * Используйте метод [PUT campaigns/{campaignId}/orders/{orderId}/boxes](../../reference/orders/setOrderBoxLayout.md).
   *
   * {% endnote %}
   *
   * Удаляет товары из заказа, если позволяет выбранная служба доставки, в случаях:
   *
   * * покупатель уменьшил количество товара;
   * * магазин не может поставить все товары в заказе.
   *
   * Для этого заказ должен находится в статусе `"status": "PROCESSING"` этапа обработки `"substatus": "STARTED"`. После передачи статуса `"substatus": "READY_TO_SHIP"` изменить состав невозможно.
   *
   * Если одинаковых товаров несколько, для уменьшения количества передайте обновленное значение в атрибуте `count` параметра `item`.
   *
   * Чтобы полностью удалить товар из заказа:
   *
   * * передайте значение `0`; или
   * * не передавайте параметр `item`.
   *
   * Нельзя удалить или уменьшить количество товара, если он:
   *
   * * добавлен по акции;
   * * составляет 99% стоимости заказа;
   * * единственный товар в заказе.
   *
   * Если необходимо удалить такой товар, отмените заказ. Для этого отправьте запрос методом [PUT campaigns/{campaignId}/orders/{orderId}/status](../../reference/orders/updateOrderStatus.md) и передайте статус заказа `CANCELLED` с причиной отмены `SHOP_FAILED`.
   *
   * {% note info "Увеличить заказ нельзя" %}
   *
   * С помощью запроса нельзя увеличить количество одинаковых товаров, добавить новые товары в заказ или заменить один товар другим.
   *
   * {% endnote %}
   *
   * **Возврат денег покупателю**
   *
   * Если покупатель оплатил товар при оформлении, Маркет вернет ему деньги за удаленные из заказа товары в течение двух дней:
   *
   * * при оплате банковской картой — с момента, когда магазин переведет заказ в статус `SHIPPED`;
   *
   * * при оплате через Apple Pay или Google Pay — с момента, когда магазин удалит товар из заказа.
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns any Маркет успешно обработал ваш запрос. Выходные данные не ожидаются.
   * @throws ApiError
   */
  public static updateOrderItems(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Список товаров в заказе.
       *
       * Если магазин не передал информацию о товаре во входных данных, он будет удален из заказа.
       *
       * Обязательный параметр.
       *
       */
      items: Array<{
        /**
         * Идентификатор товара в рамках заказа.
         *
         * Получить идентификатор можно с помощью ресурсов [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md) или [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md).
         *
         * Обязательный параметр.
         *
         */
        id: number;
        /**
         * Новое количество товара.
         */
        count: number;
        /**
         * Информация о маркировке единиц товара.
         *
         * Передавайте в запросе все единицы товара, который подлежит маркировке.
         *
         * Обязательный параметр, если в заказе от бизнеса есть товары, подлежащие маркировке в системе [«Честный ЗНАК»](https://честныйзнак.рф/) или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go).
         *
         */
        instances?: Array<{
          /**
           * Код идентификации единицы товара в системе [«Честный ЗНАК»](https://честныйзнак.рф/) или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go).
           *
           * {% note warning "Не экранируйте косую черту в коде символа-разделителя `\u001d`" %}
           *
           * ✅ `01030410947874432155Qbag!\u001d93Zjqw`
           *
           * ❌ `01030410947874432155Qbag!\\u001d93Zjqw`
           *
           * Косые черты и кавычки в других местах экранируйте по правилам JSON: `\\` и `\"`
           *
           * {% endnote %}
           *
           */
          cis?: string;
          /**
           * Уникальный идентификационный номер ювелирного изделия.
           *
           * Представляет собой число из 16 цифр.
           *
           */
          uin?: string;
          /**
           * Регистрационный номер партии товара.
           *
           * Представляет собой строку из четырех чисел, разделенных косой чертой: ХХХХХХХХ/ХХХХХХ/ХХХХХХХ/ХХХ.
           *
           * Первая часть — код таможни, которая зарегистрировала декларацию на партию товара. Далее — дата, номер декларации и номер маркированного товара в декларации.
           *
           */
          rnpt?: string;
          /**
           * Грузовая таможенная декларация.
           *
           * Представляет собой строку из трех чисел, разделенных косой чертой: ХХХХХХХХ/ХХХХХХ/ХХХХХХХ.
           *
           * Первая часть — код таможни, которая зарегистрировала декларацию на ввезенные товары. Далее — дата и номер декларации.
           *
           */
          gtd?: string;
          countryCode?: paths_1regions_1countries_post_responses_200_content_application_1json_schema_properties_countries_items_properties_countryCode;
        }> | null;
      }>;
      /**
       * Причина, почему обновился состав заказа:
       *
       * * `PARTNER_REQUESTED_REMOVE` — магазин удалил товар.
       * * `USER_REQUESTED_REMOVE` — покупатель попросил удалить товар.
       *
       */
      reason?: 'PARTNER_REQUESTED_REMOVE' | 'USER_REQUESTED_REMOVE';
    },
  ): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/items',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Изменение статуса одного заказа
   * {% include notitle [access](../../_auto/method_scopes/updateOrderStatus.md) %}
   *
   * Изменяет статус заказа. Возможные изменения статусов:
   *
   * * Если магазин подтвердил и подготовил заказ к отправке, то заказ из статуса `"status": "PROCESSING"` и этапа обработки `"substatus": "STARTED"` нужно перевести в статус `"status": "PROCESSING"` и этап обработки `"substatus": "READY_TO_SHIP"`.
   * * Если магазин подтвердил заказ, но не может его выполнить (например, товар числится в базе, но отсутствует на складе или нет нужного цвета), то заказ из статуса `"status": "PROCESSING"` и этапа обработки `"substatus": "STARTED"` нужно перевести в статус `"status": "CANCELLED"` с причиной отмены заказа `"substatus": "SHOP_FAILED"`.
   * * Если магазин подготовил заказ к отгрузке, но не может его выполнить (например, последний товар был поврежден или оказался с браком), то заказ из статуса `"status": "PROCESSING"` и этапа обработки `"substatus": "READY_TO_SHIP"` нужно перевести в статус `"status": "CANCELLED"` с причиной отмены заказа `"substatus": "SHOP_FAILED"`.
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns any В случае успешного изменения статуса заказа возвращается обновленная информация о заказе.
   * @throws ApiError
   */
  public static updateOrderStatus(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Заказ.
       */
      order: {
        status: paths_1campaigns_1_campaignId_1orders_get_parameters_2_schema_items;
        substatus?: paths_1campaigns_1_campaignId_1orders_get_parameters_3_schema_items;
        /**
         * Информация о доставке.
         */
        delivery?: {
          /**
           * Диапазон дат доставки.
           */
          dates?: {
            /**
             * **Только для модели DBS**
             *
             * Фактическая дата доставки.
             * <br><br>
             * Когда передавать параметр `realDeliveryDate`:
             *
             * * Не передавайте параметр, если:
             * * переводите заказ в любой статус, кроме `PICKUP` или `DELIVERED`;
             * * меняете статус заказа на `PICKUP` или `DELIVERED` в день доставки — будет указана дата выполнения запроса.
             * * Передавайте дату доставки, если переводите заказ в статус `PICKUP` или `DELIVERED` не в день доставки. Нельзя указывать дату доставки в будущем.
             *
             * {% note warning "Передача статуса после установленного срока снижает индекс качества" %}
             *
             * О сроках читайте [в Справке Маркета для продавцов](https://yandex.ru/support2/marketplace/ru/quality/tech#dbs).
             *
             * {% endnote %}
             *
             *
             *
             */
            realDeliveryDate?: string;
          };
        };
      };
    },
  ): CancelablePromise<{
    order?: paths_1campaigns_1_campaignId_1orders_1_orderId_get_responses_200_content_application_1json_schema_properties_order;
  }> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/status',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Изменение статусов нескольких заказов
   * {% include notitle [access](../../_auto/method_scopes/updateOrderStatuses.md) %}
   *
   * Изменяет статусы нескольких заказов.
   *
   * Возможные изменения статусов:
   *
   * * Если магазин подтвердил и подготовил заказ к отправке, то заказ из статуса `"status": "PROCESSING"`и этапа обработки `"substatus": "STARTED"` нужно перевести в статус `"status": "PROCESSING"` и этап обработки `"substatus": "READY_TO_SHIP"`.
   * * Если магазин подтвердил заказ, но не может его выполнить (например, товар числится в базе, но отсутствует на складе или нет нужного цвета), то заказ из статуса `"status": "PROCESSING"` и этапа обработки `"substatus": "STARTED"` нужно перевести в статус `"status": "CANCELLED"` с причиной отмены заказа `"substatus": "SHOP_FAILED"`.
   * * Если магазин подготовил заказ к отгрузке, но не может его выполнить (например, последний товар был поврежден или оказался с браком), то заказ из статуса `"status": "PROCESSING"` и этапа обработки `"substatus": "READY_TO_SHIP"` нужно перевести в статус `"status": "CANCELLED"` с причиной отмены заказа `"substatus": "SHOP_FAILED"`.
   *
   * |**⚙️ Лимит:** 100 000 заказов в час|
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
   * @returns any Возвращается информация об обновленных статусах заказов.
   * @throws ApiError
   */
  public static updateOrderStatuses(
    campaignId: number,
    requestBody: {
      /**
       * Список заказов.
       */
      orders: Array<{
        /**
         * Идентификатор заказа.
         */
        id: number;
        status: paths_1campaigns_1_campaignId_1orders_get_parameters_2_schema_items;
        substatus?: paths_1campaigns_1_campaignId_1orders_get_parameters_3_schema_items;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/status-update',
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
  /**
   * @deprecated
   * Передача количества грузовых мест в заказе
   * {% include notitle [access](../../_auto/method_scopes/setOrderShipmentBoxes.md) %}
   *
   * {% note warning "Какой метод использовать вместо устаревшего" %}
   *
   * [PUT campaigns/{campaignId}/orders/{orderId}/boxes](../../reference/orders/setOrderBoxLayout.md).
   *
   * {% endnote %}
   *
   * Отгружаемый Маркету заказ может не влезть в одну коробку или упаковку — в этом случае получается, что он занимает несколько грузовых мест.
   *
   * Количество грузовых мест нужно обязательно передавать Маркету, если оно не равно 1. Это делается перед переводом его в статус **Готов к отгрузке**. Подробно о том, что в какой момент нужно передавать, рассказано в [пошаговой инструкции](../../step-by-step/fbs.md).
   *
   * Метод устроен немного нестандартно: количество задается длиной массива пустых объектов.
   *
   * Раньше метод требовал передачи большего количества данных. Запросы, оформленные по старому образцу, работают, но лучше делать по-новому.
   *
   * {% cut "Как было раньше" %}
   *
   * Структура тела PUT-запроса:
   *
   * ```text translate=no
   * {
   * "boxes":
   * [
   * {
   * "fulfilmentId": "{string}",
   * "weight": {int64},
   * "width": {int64},
   * "height": {int64},
   * "depth": {int64},
   * "items":
   * [
   * {
   * "id": {int64},
   * "count": {int32}
   * },
   * ...
   * ]
   * },
   * ...
   * ]
   * }
   * ```
   * | **Параметр**  | **Тип**  | **Значение**  |
   * | ----------- | ----------- | ----------- |
   * | `boxes`       |           | Список грузовых мест.       |
   *
   * **Параметры, вложенные в `boxes`**
   * | **Параметр**  | **Тип**  | **Значение**  |
   * | ----------- | ----------- | ----------- |
   * | `fulfilmentId`       |  String   | Идентификатор грузового места в информационной системе магазина. Сформируйте идентификатор по шаблону: `номер заказа на Маркете-номер грузового места`. Например, `7206821‑1, 7206821‑2` и т. д. |
   * | `weight`       | Int64        | Масса брутто грузового места (суммарная масса упаковки и содержимого) в граммах. |
   * | `width`       | Int64   | Ширина грузового места в сантиметрах.       |
   * | `height`       | Int64   | Высота грузового места в сантиметрах.       |
   * | `depth`       | Int64   | Глубина грузового места в сантиметрах.        |
   * | `items`       | Int64   | Список товаров в грузовом месте.       |
   *
   * **Параметры, вложенные в `items`**
   * | **Параметр**  | **Тип**  | **Значение**  |
   * | ----------- | ----------- | ----------- |
   * | `id`       | Int64     | Идентификатор товара в рамках заказа.   |
   * | `count`    | Int32     | Количество единиц товара в грузовом месте.       |
   *
   * {% endcut %}
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
   * @param orderId Идентификатор заказа.
   * @param shipmentId Параметр больше не используется. Вставьте любое число — просто чтобы получился корректный URL.
   *
   * @param requestBody
   * @returns any Имеет значение только тип ответа. Если ответ `ОК`, количество грузомест записано.
   * @throws ApiError
   */
  public static setOrderShipmentBoxes(
    campaignId: number,
    orderId: number,
    shipmentId: number,
    requestBody: {
      /**
       * Список грузовых мест. По его длине Маркет определяет количество мест.
       */
      boxes: Array<{
        /**
         * {% note warning "Не используйте этот параметр." %}
         *
         *
         *
         * {% endnote %}
         *
         * @deprecated
         */
        fulfilmentId?: string;
      }>;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/delivery/shipments/{shipmentId}/boxes',
      path: {
        campaignId: campaignId,
        orderId: orderId,
        shipmentId: shipmentId,
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
   * Отмена заказа покупателем
   * {% include notitle [access](../../_auto/method_scopes/acceptOrderCancellation.md) %}
   *
   * Подтверждает или отклоняет заявку покупателя на отмену заказа, который передан службе доставки.
   *
   * Покупатель может отменить заказ в течение его обработки или доставки. Если заказ еще обрабатывается (статус `PROCESSING`), вам не нужно подтверждать отмену заказа — он будет отменен автоматически.
   *
   * Если заказ уже передан службе доставки (статус `DELIVERY` или `PICKUP`) и пользователь отменил его, вы можете предупредить службу об отмене в течение 48 часов.
   *
   * * Служба доставки узнала об отмене до передачи заказа покупателю — подтвердите отмену с помощью запроса [PUT campaigns/{campaignId}/orders/{orderId}/cancellation/accept](../../reference/orders/acceptOrderCancellation.md).
   * * Заказ уже доставлен — отклоните отмену с помощью этого же запроса. Тогда у покупателя останется заказ, и деньги за него возвращаться не будут.
   *
   * **Как узнать об отмененных заказах:**
   *
   * * Отправьте запрос [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md). В его URL добавьте входной параметр `onlyWaitingForCancellationApprove=true`.
   * * В кабинете или через почту — на нее придет уведомление об отмене.
   * * Подключите API-уведомления. Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда появится новая заявка на отмену заказа. [{#T}](../../push-notifications/index.md)
   *
   * Если в течение 48 часов вы не подтвердите или отклоните отмену, заказ будет отменен автоматически.
   *
   * |**⚙️ Лимит:** 500 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Ответ на отмену заказа был успешно передан.
   * @throws ApiError
   */
  public static acceptOrderCancellation(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Решение об отмене заказа:
       *
       * * `true` — заказ отменяется, служба доставки узнала об отмене до передачи заказа покупателю.
       * * `false` — заказ не отменяется, так как он уже доставлен покупателю курьером или передан в пункт выдачи заказов.
       *
       */
      accepted: boolean;
      /**
       * Причина, по которой заказ не может быть отменен (она сообщается покупателю).
       *
       * Обязательный параметр, если вы передаете `accepted="false"`.
       *
       */
      reason?: 'ORDER_DELIVERED' | 'ORDER_IN_DELIVERY';
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/cancellation/accept',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Передача ключей цифровых товаров
   * {% include notitle [access](../../_auto/method_scopes/provideOrderDigitalCodes.md) %}
   *
   * Передает ключи цифровых товаров, которые покупатель заказал и оплатил. После выполнения запроса Маркет отправит ему письмо с ключами и инструкциями по активации. Если письмо будет доставлено, Маркет переведет заказ в финальный статус `DELIVERED`.
   *
   * {% note tip "После передачи кода покупателю статус заказа изменится не сразу" %}
   *
   * Подключите API-уведомления — Маркет отправит вам запрос [POST notification](../../push-notifications/reference/sendNotification.md), когда заказ перейдет в статус `DELIVERED`.
   *
   * [{#T}](../../push-notifications/index.md)
   *
   * {% endnote %}
   *
   * Ключ нужно передать в течение 30 минут после перехода заказа в статус `PROCESSING`.
   *
   * Если в один заказ входят несколько ключей, передавайте их все в одном запросе.
   *
   * Каждый товар с уникальным `id` передавайте в виде отдельного элемента в массиве `items`, а ключи товара — в массиве `codes`.
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Пустой ответ.
   *
   * {% note warning "Ответ 200 сам по себе не значит, что ключи переданы покупателю" %}
   *
   * Если письмо с ключами удалось доставить, Маркет переведет заказ в финальный статус `DELIVERED`.
   *
   * Статус заказа можно узнать с помощью метода [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md) или [GET campaigns/{campaignId}/orders](../../reference/orders/getOrders.md).
   *
   * {% endnote %}
   *
   * @throws ApiError
   */
  public static provideOrderDigitalCodes(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Список проданных товаров.
       *
       * Если в заказе есть несколько **одинаковых** товаров (например, несколько ключей к одной и той же подписке), передайте ключи в виде массива к этому товару. Параметр `id` у этих элементов должен быть один и тот же.
       *
       */
      items: Array<{
        /**
         * Идентификатор товара в заказе.
         *
         * Он приходит в ответе на запрос [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md) — параметр `id` в `items`.
         *
         */
        id: number;
        /**
         * {% note warning "Вместо него используйте `codes`" %}
         *
         * Совместное использование обоих параметров приведет к ошибке.
         *
         * {% endnote %}
         *
         * Сам ключ.
         *
         * @deprecated
         */
        code?: string;
        /**
         * Ключи, относящиеся к товару.
         */
        codes?: Array<string> | null;
        /**
         * Инструкция по активации.
         */
        slip: string;
        /**
         * Дата, до которой нужно активировать ключи. Если ключи действуют бессрочно, укажите любую дату в отдаленном будущем.
         *
         * Формат даты: `ГГГГ-ММ-ДД`.
         *
         */
        activate_till: string;
      }>;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/{orderId}/deliverDigitalGoods',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Подготовка заказа
   * {% include notitle [access](../../_auto/method_scopes/setOrderBoxLayout.md) %}
   *
   * {% note tip "Подходит и для DBS" %}
   *
   * Запрос предназначен для работы с FBS-заказами, но вы можете использовать его для обработки DBS-заказов, если это удобно.
   *
   * {% endnote %}
   *
   * Позволяет выполнить три операции:
   *
   * * передать Маркету информацию о распределении товаров по коробкам;
   * * передать Маркету коды маркировки для товаров;
   * * удалить товар из заказа, если его не оказалось на складе.
   *
   * Если нужно что-то поправить в переданных данных, просто повторите запрос — это можно делать сколько угодно раз до перевода заказа в статус **Готов к отгрузке**. ⚠️ Если вы меняете раскладку уже после печати и расклейки ярлыков, не забудьте перепечатать их и наклеить заново.
   *
   * ## Как передать информацию о распределении товаров
   *
   * В этом запросе вам нужно передать Маркету список коробок и указать, какие именно товары лежат в каждой из них. Коробки могут быть двух типов:
   *
   * * **Содержащие товары целиком.** Такая коробка может содержать сколько угодно единиц любых товаров.
   *
   * * **Содержащие часть товара.** Такие коробки содержат по одной части одного товара. Например, одна содержит внешний блок кондиционера, а другая — внутренний блок.
   *
   * ⚠️ Одна коробка не может содержать и товары целиком, и части товаров.
   *
   * ## Как передавать коды маркировки
   *
   * {% note info "Маркировка товаров в системе [«Честный ЗНАК»](https://честныйзнак.рф/) необязательна для заказов от физических лиц" %}
   *
   * Для заказов от бизнеса все еще нужно передавать коды маркировки.
   *
   * {% endnote %}
   *
   * Если в заказе есть товары, подлежащие маркировке, в запросе нужно передать соответствующие уникальные коды. [Что такое маркировка?](https://yandex.ru/support/marketplace/orders/cz.html)
   *
   * Принимаются коды следующих типов:
   *
   * * Коды в системе [«Честный ЗНАК»](https://честныйзнак.рф/) или [«ASL BELGISI»](https://aslbelgisi.uz) (для продавцов Market Yandex Go).
   * * УИН для ювелирных изделий.
   * * РНПТ и ГТД для импортных прослеживаемых товаров.
   *
   * Для каждой позиции в заказе, требующей маркировки, нужно передать список кодов — по одному для каждой единицы товара. Например, если в заказе две пары тапочек и одна пара туфель, получится список из двух кодов для первой позиции и список из одного кода для второй.
   *
   * Если товар едет в нескольких коробках, код маркировки нужно передать для каждой из них.
   *
   * {% note warning "Для заказов, в которых есть ювелирные изделия" %}
   *
   * Заказ перейдет в статус `READY_TO_SHIP`, только когда:
   *
   * 1. Вы передадите Маркету УИНы по каждому ювелирному изделию в заказе.
   * 2. Все УИНы успешно пройдут проверку. [Как получить статусы проверки УИНов](../../reference/orders/getOrderIdentifiersStatus.md)
   *
   * {% endnote %}
   *
   * ## Как удалить товар из заказа
   *
   * Чтобы удалить товар из заказа:
   *
   * 1. Добавьте в запрос `allowRemove: true`.
   * 2. Передайте распределение по коробкам без товара, который нужно удалить.
   *
   * {% note warning "Удаление нельзя отменить" %}
   *
   * Эта операция необратима: покупатель сразу получит уведомление, а состав заказа изменится.
   *
   * {% endnote %}
   *
   * Чтобы удалить позицию целиком, не передавайте соответствующий `OrderBoxLayoutItemDTO`. Чтобы уменьшить количество товара, передайте уменьшенное значение в поле `fullCount`.
   *
   * Нельзя удалить или уменьшить количество товара, если он:
   *
   * * добавлен по акции;
   * * составляет 99% стоимости заказа;
   * * единственный товар в заказе.
   *
   * Если вы не можете отгрузить такой товар, отмените заказ. Для этого отправьте запрос методом [PUT campaigns/{campaignId}/orders/{orderId}/status](../../reference/orders/updateOrderStatus.md) и передайте статус заказа `CANCELLED` с причиной отмены `SHOP_FAILED`.
   *
   * {% note info "Увеличить заказ нельзя" %}
   *
   * С помощью запроса нельзя увеличить количество одинаковых товаров, добавить новые товары в заказ или заменить один товар другим.
   *
   * {% endnote %}
   *
   * ## Примеры
   *
   * {% cut "Товар умещается в коробку" %}
   *
   * Вот как будет выглядеть запрос, если в одной коробке едут:
   *
   * * три единицы одного товара, требующего маркировки;
   * * одна единица другого товара, не требущего маркировки.
   *
   * ```json translate=no
   * {
   * "boxes": [
   * {
   * "items": [
   * {
   * "id": 123456,
   * "fullCount": 3,
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * },
   * {
   * "cis": "010304109478gftJ14545762!\u001dhGt264"
   * },
   * {
   * "cis": "010304109478fRs28323ks23!\u001dhet201"
   * }
   * ]
   * },
   * {
   * "id": 654321,
   * "fullCount": 1
   * }
   * ]
   * }
   * ]
   * }
   * ```
   *
   * {% endcut %}
   *
   * {% cut "Товар едет в разных коробках" %}
   *
   * Вот как будет выглядеть запрос, если товар едет в двух коробках:
   *
   * ```json translate=no
   * {
   * "boxes": [
   * {
   * "items": [
   * {
   * "id": 123456,
   * "partialCount": {
   * "current": 1,
   * "total": 2
   * },
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * }
   * ]
   * }
   * ]
   * },
   * {
   * "items": [
   * {
   * "id": 123456,
   * "partialCount": {
   * "current": 2,
   * "total": 2
   * },
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * }
   * ]
   * }
   * ]
   * }
   * ]
   * }
   * ```
   *
   * {% endcut %}
   *
   * {% cut "Одинаковые товары, где каждый едет в нескольких коробках" %}
   *
   * Вот как будет выглядеть запрос, если каждый из двух одинаковых товаров едет в двух коробках:
   *
   * ```json translate=no
   * {
   * "boxes": [
   * {
   * "items": [
   * {
   * "id": 123456,
   * "partialCount": {
   * "current": 1,
   * "total": 2
   * },
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * }
   * ]
   * }
   * ]
   * },
   * {
   * "items": [
   * {
   * "id": 123456,
   * "partialCount": {
   * "current": 2,
   * "total": 2
   * },
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * }
   * ]
   * }
   * ]
   * },
   * {
   * "items": [
   * {
   * "id": 123456,
   * "partialCount": {
   * "current": 1,
   * "total": 2
   * },
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * }
   * ]
   * }
   * ]
   * },
   * {
   * "items": [
   * {
   * "id": 123456,
   * "partialCount": {
   * "current": 2,
   * "total": 2
   * },
   * "instances": [
   * {
   * "cis": "01030410947874432155Qbag!\u001d93Zjqw"
   * }
   * ]
   * }
   * ]
   * }
   * ]
   * }
   * ```
   *
   * {% endcut %}
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns any В ответ придет переданная раскладка с идентификаторами коробок — они понадобятся для запроса ярлыков.
   *
   * @throws ApiError
   */
  public static setOrderBoxLayout(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Список коробок.
       */
      boxes: Array<{
        /**
         * Список товаров в коробке.
         *
         * Если в коробке едет часть большого товара, в списке может быть только один пункт.
         *
         */
        items: Array<{
          /**
           * Идентификатор товара в заказе.
           *
           * Он приходит в ответе на запрос [GET campaigns/{campaignId}/orders/{orderId}](../../reference/orders/getOrder.md) — параметр `id` в `items`.
           *
           */
          id: number;
          /**
           * Количество единиц товара в коробке.
           *
           * Используйте это поле, если в коробке поедут целые товары, не разделенные на части. Не используйте это поле одновременно с `partialCount`.
           *
           */
          fullCount?: number;
          /**
           * Часть товара в коробке.
           *
           * Используйте это поле, если в коробке поедет часть большого товара. Не используйте это поле одновременно с `fullCount`.
           *
           */
          partialCount?: {
            /**
             * Номер части, начиная с 1.
             */
            current: number;
            /**
             * На сколько всего частей разделен товар.
             */
            total: number;
          };
          /**
           * Переданные вами коды маркировки.
           */
          instances?: Array<paths_1campaigns_1_campaignId_1orders_1_orderId_1items_put_requestBody_content_application_1json_schema_properties_items_items_properties_instances_items> | null;
        }>;
      }>;
      /**
       * Передайте `true`, если вы собираетесь удалить часть товаров из заказа.
       */
      allowRemove?: boolean;
    },
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/campaigns/{campaignId}/orders/{orderId}/boxes',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Передача или изменение дополнительного идентификатора заказа
   * {% include notitle [access](../../_auto/method_scopes/updateExternalOrderId.md) %}
   *
   * При первом использовании запроса передает Маркету идентификатор заказа в системе магазина. При повторном — изменяет его в системе Маркета.
   *
   * Передать данные можно до перехода заказа в статус `PROCESSING` с подстатусом `READY_TO_SHIP`.
   *
   * |**⚙️ Лимит:** 10 000 запросов в час|
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
   * @param orderId Идентификатор заказа.
   * @param requestBody
   * @returns paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema Дополнительный идентификатор заказа успешно передан или изменен.
   * @throws ApiError
   */
  public static updateExternalOrderId(
    campaignId: number,
    orderId: number,
    requestBody: {
      /**
       * Дополнительный идентификатор заказа.
       */
      externalOrderId: string;
    },
  ): CancelablePromise<paths_1campaigns_1_campaignId_1bids_put_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/{orderId}/external-id',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
   * Статусы проверки УИНов
   * {% include notitle [access](../../_auto/method_scopes/getOrderIdentifiersStatus.md) %}
   *
   * Возвращает статусы проверки [УИНов](*uin) в заказе.
   *
   * Заказ, в котором есть ювелирные изделия, перейдет в статус `READY_TO_SHIP`, только когда:
   *
   * 1. Вы передадите Маркету УИНы по каждому ювелирному изделию в заказе — метод [PUT campaigns/{campaignId}/orders/{orderId}/boxes](../../reference/orders/setOrderBoxLayout.md).
   * 2. Все УИНы успешно пройдут проверку.
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
   * @param orderId Идентификатор заказа.
   * @returns any Информация по проверке УИНов.
   * @throws ApiError
   */
  public static getOrderIdentifiersStatus(
    campaignId: number,
    orderId: number,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/campaigns/{campaignId}/orders/{orderId}/identifiers/status',
      path: {
        campaignId: campaignId,
        orderId: orderId,
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
