/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items } from '../models/paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items';
import type { paths_1campaigns_1_campaignId_1returns_get_parameters_5_schema } from '../models/paths_1campaigns_1_campaignId_1returns_get_parameters_5_schema';
import type { paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_month } from '../models/paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_month';
import type { paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_year } from '../models/paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_year';
import type { paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema } from '../models/paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema';
import type { paths_1reports_1shows_boost_1generate_post_requestBody_content_application_1json_schema_properties_attributionType } from '../models/paths_1reports_1shows_boost_1generate_post_requestBody_content_application_1json_schema_properties_attributionType';
import type { paths_1reports_1united_netting_1generate_post_requestBody_content_application_1json_schema_properties_placementPrograms_items } from '../models/paths_1reports_1united_netting_1generate_post_requestBody_content_application_1json_schema_properties_placementPrograms_items';
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ReportsService {
  /**
   * Получение заданного отчета
   * {% include notitle [access](../../_auto/method_scopes/getReportInfo.md) %}
   *
   * Возвращает статус генерации заданного отчета и, если отчет готов, ссылку для скачивания.
   *
   * Чтобы воспользоваться этим запросом, вначале нужно запустить генерацию отчета. [Инструкция](../../step-by-step/reports.md)
   *
   * |**⚙️ Лимит:** 100 запросов в минуту|
   * |-|
   *
   * @param reportId Идентификатор отчета, который вы получили после запуска генерации.
   *
   * @returns any Статус генерации отчета и ссылка, если она уже есть.
   *
   * {% note tip "Статус генерации отчета `FAILED` или `NO_DATA`" %}
   *
   * Проверьте корректность запроса на генерацию. Например, верно ли указан идентификатор кампании, период или номер платежного поручения.
   *
   * {% endnote %}
   *
   *
   *
   * @throws ApiError
   */
  public static getReportInfo(
    reportId: string,
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/reports/info/{reportId}',
      path: {
        reportId: reportId,
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
   * Отчет по платежам
   * {% include notitle [access](../../_auto/method_scopes/generateUnitedNettingReport.md) %}
   *
   * Запускает генерацию **отчета по платежам** за заданный период. [Что это за отчет](https://yandex.ru/support/marketplace/ru/accounting/transactions#all-pay)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * Тип отчета зависит от того, какие поля заполнены в запросе:
   *
   * #|
   * || **Тип отчета** | **Какие поля нужны** ||
   * || О платежах за период | `dateFrom` и `dateTo` ||
   * || О платежном поручении | `bankOrderId` и `bankOrderDateTime` ||
   * || [О баллах Маркета](*баллы_маркета) | `monthOfYear` ||
   * |#
   *
   * Заказать отчеты нескольких типов одним запросом нельзя.
   *
   * {% include notitle [reports](../../_auto/reports/united/netting/generator/united_netting.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @param language Язык отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateUnitedNettingReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       * @deprecated
       */
      dateTimeFrom?: string;
      /**
       * Конец периода, включительно. Максимальный период — 3 месяца.
       * @deprecated
       */
      dateTimeTo?: string;
      /**
       * Начало периода, включительно.
       */
      dateFrom?: string;
      /**
       * Конец периода, включительно. Максимальный период — 3 месяца.
       */
      dateTo?: string;
      /**
       * Номер платежного поручения.
       */
      bankOrderId?: number;
      /**
       * Дата платежного поручения.
       */
      bankOrderDateTime?: string;
      /**
       * Месяц, за который нужен отчет о баллах Маркета.
       */
      monthOfYear?: {
        year: paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_year;
        month: paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_month;
      };
      /**
       * Список моделей, которые нужны в отчете.
       *
       */
      placementPrograms?: Array<'FBS' | 'FBY' | 'DBS'> | null;
      /**
       * Список ИНН, которые нужны в отчете.
       */
      inns?: Array<string> | null;
      /**
       * Список идентификаторов кампании тех магазинов, которые нужны в отчете.
       *
       * Их можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не используйте вместо них идентификаторы магазинов, которые указаны в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignIds?: Array<number> | null;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
    language?: 'RU' | 'EN',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/united-netting/generate',
      query: {
        format: format,
        language: language,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по стоимости услуг
   * {% include notitle [access](../../_auto/method_scopes/generateUnitedMarketplaceServicesReport.md) %}
   *
   * Запускает генерацию **отчета по стоимости услуг** за заданный период. [Что это за отчет](https://yandex.ru/support/marketplace/ru/accounting/transactions#reports)
   *
   * Тип отчета зависит от того, какие поля заполнены в запросе:
   *
   * |**Тип отчета**               |**Какие поля нужны**             |
   * |-----------------------------|---------------------------------|
   * |По дате начисления услуги    |`dateFrom` и `dateTo`            |
   * |По дате формирования акта    |`year` и `month`                 |
   *
   * Заказать отчеты обоих типов одним запросом нельзя.
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/united/services/generator/united_marketplace_services.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @param language Язык отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateUnitedMarketplaceServicesReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       * @deprecated
       */
      dateTimeFrom?: string;
      /**
       * Конец периода, включительно. Максимальный период — 3 месяца.
       * @deprecated
       */
      dateTimeTo?: string;
      /**
       * Начало периода, включительно.
       */
      dateFrom?: string;
      /**
       * Конец периода, включительно. Максимальный период — 3 месяца.
       */
      dateTo?: string;
      /**
       * Начальный год формирования акта.
       */
      yearFrom?: paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_year;
      /**
       * Начальный номер месяца формирования акта.
       */
      monthFrom?: paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_month;
      /**
       * Конечный год формирования акта.
       */
      yearTo?: paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_year;
      /**
       * Конечный номер месяца формирования акта.
       */
      monthTo?: paths_1reports_1goods_realization_1generate_post_requestBody_content_application_1json_schema_properties_month;
      /**
       * Список моделей, которые нужны в отчете.
       *
       */
      placementPrograms?: Array<paths_1reports_1united_netting_1generate_post_requestBody_content_application_1json_schema_properties_placementPrograms_items> | null;
      /**
       * Список ИНН, которые нужны в отчете.
       */
      inns?: Array<string> | null;
      /**
       * Список идентификаторов кампании тех магазинов, которые нужны в отчете.
       *
       * Их можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не используйте вместо них идентификаторы магазинов, которые указаны в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignIds?: Array<number> | null;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
    language?: 'RU' | 'EN',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/united-marketplace-services/generate',
      query: {
        format: format,
        language: language,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по заказам
   * {% include notitle [access](../../_auto/method_scopes/generateUnitedOrdersReport.md) %}
   *
   * Запускает генерацию **отчета по заказам** за заданный период. [Что это за отчет](https://yandex.ru/support/marketplace/ru/accounting/transactions#get-report)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/united/orders/generator/united_orders.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @param language Язык отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateUnitedOrdersReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно. Максимальный период — 1 год.
       */
      dateTo: string;
      /**
       * Список идентификаторов кампании тех магазинов, которые нужны в отчете.
       *
       * Их можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не используйте вместо них идентификаторы магазинов, которые указаны в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignIds?: Array<number> | null;
      /**
       * Идентификатор акции, товары из которой нужны в отчете.
       */
      promoId?: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
    language?: 'RU' | 'EN',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/united-orders/generate',
      query: {
        format: format,
        language: language,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по невыкупам и возвратам
   * {% include notitle [access](../../_auto/method_scopes/generateUnitedReturnsReport.md) %}
   *
   * Запускает генерацию **сводного отчета по невыкупам и возвратам** за заданный период. [Что это за отчет](https://yandex.ru/support/marketplace/ru/orders/returns/logistic#rejected-orders)
   *
   * Отчет содержит информацию о невыкупах и возвратах за указанный период, а также о тех, которые готовы к выдаче.
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/united/returns/generator/united_returns.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateUnitedReturnsReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
      /**
       * Список идентификаторов кампании тех магазинов, которые нужны в отчете.
       *
       * Их можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не используйте вместо них идентификаторы магазинов, которые указаны в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignIds?: Array<number> | null;
      returnType?: paths_1campaigns_1_campaignId_1returns_get_parameters_5_schema | null;
      /**
       * Статусы передачи возвратов, которые нужны в отчете.
       *
       * Если их не указать, вернется информация по всем возвратам.
       *
       */
      returnStatusTypes?: Array<
        | 'CREATED'
        | 'RECEIVED'
        | 'IN_TRANSIT'
        | 'READY_FOR_PICKUP'
        | 'PICKED'
        | 'LOST'
        | 'EXPIRED'
        | 'CANCELLED'
        | 'FULFILMENT_RECEIVED'
        | 'PREPARED_FOR_UTILIZATION'
        | 'NOT_IN_DEMAND'
        | 'UTILIZED'
        | 'READY_FOR_EXPROPRIATION'
        | 'RECEIVED_FOR_EXPROPRIATION'
        | 'UNKNOWN'
      > | null;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/united-returns/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по реализации
   * {% include notitle [access](../../_auto/method_scopes/generateGoodsRealizationReport.md) %}
   *
   * Запускает генерацию **отчета по реализации** за заданный период. [Что это за отчет](https://yandex.ru/support/marketplace/ru/accounting/transactions#sales-report)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% list tabs %}
   *
   * - FBY, FBS, Экспресс
   *
   * {% include notitle [reports](../../_auto/reports/united/statistics/generator/united_statistics_v2.md) %}
   *
   * - DBS
   *
   * {% include notitle [reports](../../_auto/reports/united/statistics/generator/united_statistics_v2_dbs.md) %}
   *
   * {% endlist %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateGoodsRealizationReport(
    requestBody: {
      /**
       * Идентификатор кампании.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId: number;
      /**
       * Год.
       */
      year: number;
      /**
       * Номер месяца.
       */
      month: number;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/goods-realization/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет «Цены на рынке»
   * {% include notitle [access](../../_auto/method_scopes/generatePricesReport.md) %}
   *
   * Запускает генерацию **отчета «Цены на рынке»**.
   *
   * В отчете возвращается информация только по 50 000 товаров. Если у вас их больше, используйте фильтры.
   *
   * {% note warning "Данные в этом отчете постоянно обновляются" %}
   *
   * Поэтому информация в нем и в кабинете продавца на Маркете на странице **Цены** может отличаться.
   *
   * {% endnote %}
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/prices/business_prices_v2.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns any В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generatePricesReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       *
       * В большинстве случаев обязателен. Не указывается, если задан `campaignId`.
       *
       */
      businessId?: number;
      /**
       * Идентификатор кампании.
       *
       * Передавайте, только если в кабинете есть магазины с уникальными ценами и вы хотите получить отчет для них. В этом случае передавать `businessId` не нужно.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId?: number;
      /**
       * Фильтр по категориям на Маркете.
       */
      categoryIds?: Array<number> | null;
      /**
       * Фильтр по времени появления предложения — начало периода.
       *
       * Формат даты: `ДД-ММ-ГГГГ`.
       *
       */
      creationDateFrom?: string;
      /**
       * Фильтр по времени появления предложения — окончание периода.
       *
       * Формат даты: `ДД-ММ-ГГГГ`.
       *
       */
      creationDateTo?: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/prices/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по остаткам на складах
   * {% include notitle [access](../../_auto/method_scopes/generateStocksOnWarehousesReport.md) %}
   *
   * Запускает генерацию **отчета по остаткам на складах**. [Что это за отчет](https://yandex.ru/support/marketplace/ru/storage/logistics#remains-history)
   *
   * Отчет содержит данные:
   *
   * * Для модели FBY — об остатках на складах Маркета.
   * * Для остальных моделей — об остатках на соответствующем складе магазина.
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/stocks/stocks_on_warehouses.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateStocksOnWarehousesReport(
    requestBody: {
      /**
       * Идентификатор кампании.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId: number;
      /**
       * Фильтр по идентификаторам складов (только модель FBY). Чтобы узнать идентификатор, воспользуйтесь запросом [GET warehouses](../../reference/warehouses/getFulfillmentWarehouses.md).
       */
      warehouseIds?: Array<number> | null;
      /**
       * Фильтр по дате (для модели FBY). В отчет попадут данные за **предшествующий** дате день.
       */
      reportDate?: string;
      /**
       * Фильтр по категориям на Маркете (кроме модели FBY).
       */
      categoryIds?: Array<number> | null;
      /**
       * Фильтр по наличию остатков (кроме модели FBY).
       */
      hasStocks?: boolean;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/stocks-on-warehouses/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по движению товаров
   * {% include notitle [access](../../_auto/method_scopes/generateGoodsMovementReport.md) %}
   *
   * Запускает генерацию **отчета по движению товаров**. [Что это за отчет](https://yandex.ru/support/marketplace/analytics/reports-fby-fbs.html#flow)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/sku/movement/movement_config.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateGoodsMovementReport(
    requestBody: {
      /**
       * Идентификатор кампании.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId: number;
      /**
       * Начало периода, включительно. Формат даты: `ГГГГ-ММ-ДД`.
       *
       */
      dateFrom: string;
      /**
       * Конец периода, включительно. Формат даты: `ГГГГ-ММ-ДД`.
       *
       */
      dateTo: string;
      shopSku?: paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/goods-movement/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет «Аналитика продаж»
   * {% include notitle [access](../../_auto/method_scopes/generateShowsSalesReport.md) %}
   *
   * Запускает генерацию **отчета «Аналитика продаж»** за заданный период. [Что это за отчет](https://yandex.ru/support/marketplace/analytics/shows-sales.html)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/masterstat/sales_funnel_promotions.md) %}
   *
   * |**⚙️ Лимит:** 10 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateShowsSalesReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       *
       * Указывается, если нужно составить отчет по всем магазинам в кабинете. В запросе обязательно должен быть либо `businessId`, либо `campaignId`, но не оба сразу.
       *
       */
      businessId?: number;
      /**
       * Идентификатор кампании.
       *
       * Указывается, если нужно составить отчет по конкретному магазину. В запросе обязательно должен быть либо `businessId`, либо `campaignId`, но не оба сразу.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId?: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
      /**
       * Группировка данных отчета.
       */
      grouping: 'CATEGORIES' | 'OFFERS';
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/shows-sales/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет «Конкурентная позиция»
   * {% include notitle [access](../../_auto/method_scopes/generateCompetitorsPositionReport.md) %}
   *
   * Запускает генерацию **отчета «Конкурентная позиция»** за заданный период. [Что это за отчет](https://yandex.ru/support2/marketplace/ru/analytics/competitors.html)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% note info "Значение -1 в отчете" %}
   *
   * Если в CSV-файле в столбце **POSITION** стоит -1, в этот день не было заказов с товарами в указанной категории.
   *
   * {% endnote %}
   *
   * {% include notitle [reports](../../_auto/reports/masterstat/competitors_position.md) %}
   *
   * |**⚙️ Лимит:** 10 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateCompetitorsPositionReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Идентификатор категории.
       */
      categoryId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/competitors-position/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по оборачиваемости
   * {% include notitle [access](../../_auto/method_scopes/generateGoodsTurnoverReport.md) %}
   *
   * Запускает генерацию **отчета по оборачиваемости** за заданную дату.  [Что это за отчет](https://yandex.ru/support/marketplace/ru/storage/logistics#turnover)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/turnover/turnover.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateGoodsTurnoverReport(
    requestBody: {
      /**
       * Идентификатор кампании.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId: number;
      /**
       * Дата, за которую нужно рассчитать оборачиваемость. Если параметр не указан, используется текущая дата.
       */
      date?: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/goods-turnover/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по бусту продаж
   * {% include notitle [access](../../_auto/method_scopes/generateBoostConsolidatedReport.md) %}
   *
   * Запускает генерацию **сводного отчета по бусту продаж** за заданный период. [Что такое буст продаж](https://yandex.ru/support/marketplace/ru/marketing/campaigns)
   *
   * Отчет содержит информацию по всем кампаниям, созданным и через API, и в кабинете.
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/boost/consolidated/business_boost_consolidated.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateBoostConsolidatedReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/boost-consolidated/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Получение листа сборки
   * {% include notitle [access](../../_auto/method_scopes/generateShipmentListDocumentReport.md) %}
   *
   * Запускает генерацию **листа сборки** для отгрузки.
   *
   * Узнать статус генерации и получить ссылку на готовый документ можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый документ.
   * @throws ApiError
   */
  public static generateShipmentListDocumentReport(requestBody: {
    /**
     * Идентификатор кампании.
     *
     * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
     *
     * * **Модули и API** → блок **Передача данных Маркету**.
     * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
     *
     * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
     *
     */
    campaignId: number;
    /**
     * Идентификатор отгрузки.
     */
    shipmentId?: number;
    /**
     * Фильтр по идентификаторам заказа в отгрузке.
     */
    orderIds?: Array<number> | null;
  }): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/documents/shipment-list/generate',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по полкам
   * {% include notitle [access](../../_auto/method_scopes/generateShelfsStatisticsReport.md) %}
   *
   * Запускает генерацию **сводного отчета по полкам** — рекламным блокам с баннером или видео и набором товаров. Подробнее о них читайте [в Справке Маркета для продавцов](https://yandex.ru/support2/marketplace/ru/marketing/shelf).
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/incuts/shelfs_statistics.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateShelfsStatisticsReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
      /**
       * Тип атрибуции.
       */
      attributionType: paths_1reports_1shows_boost_1generate_post_requestBody_content_application_1json_schema_properties_attributionType;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/shelf-statistics/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Готовые ярлыки‑наклейки на все коробки в нескольких заказах
   * {% include notitle [access](../../_auto/method_scopes/generateMassOrderLabelsReport.md) %}
   *
   * Запускает генерацию PDF-файла с ярлыками для переданных заказов. Подробно о том, зачем они нужны и как выглядят, рассказано [в Справке Маркета для продавцов](https://yandex.ru/support/marketplace/orders/fbs/packaging/marking.html).
   *
   * Узнать статус генерации и получить ссылку на готовый файл можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * |**⚙️ Лимит:** 1 000 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Настройка размещения ярлыков на странице. Если параметра нет, возвращается PDF с ярлыками формата A7.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый файл.
   *
   * Если при генерации не удалось найти часть заказов, в ответе на запрос получения готового файла вернется подстатус `RESOURCE_NOT_FOUND`.
   *
   * @throws ApiError
   */
  public static generateMassOrderLabelsReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Список идентификаторов заказов.
       */
      orderIds: Array<number>;
      /**
       * Тип сортировки ярлыков в файле.
       */
      sortingType?: 'SORT_BY_GIVEN_ORDER' | 'SORT_BY_ORDER_CREATED_AT';
    },
    format?: 'A9_HORIZONTALLY' | 'A9' | 'A7' | 'A4',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/documents/labels/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по отзывам о товарах
   * {% include notitle [access](../../_auto/method_scopes/generateGoodsFeedbackReport.md) %}
   *
   * Запускает генерацию **отчета по отзывам о товарах**. [Что это за отчет](https://yandex.ru/support/marketplace/ru/marketing/plus-reviews#stat)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/paid_opinion_models/paid_opinion_models.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateGoodsFeedbackReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/goods-feedback/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по бусту показов
   * {% include notitle [access](../../_auto/method_scopes/generateShowsBoostReport.md) %}
   *
   * Запускает генерацию **сводного отчета по бусту показов** за заданный период. [Что такое буст показов](https://yandex.ru/support/marketplace/ru/marketing/boost-shows)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/cpm_boost/business_cpm_boost_consolidated.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateShowsBoostReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
      /**
       * Тип атрибуции.
       */
      attributionType: 'CLICKS' | 'SHOWS';
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/shows-boost/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по охватному продвижению
   * {% include notitle [access](../../_auto/method_scopes/generateBannersStatisticsReport.md) %}
   *
   * Запускает генерацию **сводного отчета по охватному продвижению**. Что это за отчет: [для баннеров](https://yandex.ru/support/marketplace/ru/marketing/advertising-tools/banner#statistics), [для пуш-уведомлений](https://yandex.ru/support/marketplace/ru/marketing/advertising-tools/push-notifications#statistics).
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/incuts/banners_statistics.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateBannersStatisticsReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/banners-statistics/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по заказам с ювелирными изделиями
   * {% include notitle [access](../../_auto/method_scopes/generateJewelryFiscalReport.md) %}
   *
   * Запускает генерацию **отчета по заказам с ювелирными изделиями**.
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/identifiers/jewelry/orders_jewelry_fiscal.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateJewelryFiscalReport(
    requestBody: {
      /**
       * Идентификатор кампании.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/jewelry-fiscal/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по географии продаж
   * {% include notitle [access](../../_auto/method_scopes/generateSalesGeographyReport.md) %}
   *
   * Запускает генерацию **отчета по географии продаж**. [Что это за отчет](https://yandex.ru/support/marketplace/ru/analytics/sales-geography)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/locality/locality_offers_report_v2.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateSalesGeographyReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       */
      businessId: number;
      /**
       * Начало периода, включительно.
       */
      dateFrom: string;
      /**
       * Конец периода, включительно.
       */
      dateTo: string;
      /**
       * Идентификаторы категорий.
       */
      categoryIds?: Array<number> | null;
      /**
       * Идентификаторы товаров.
       */
      offerIds?: Array<paths_1campaigns_1_campaignId_1hidden_offers_get_parameters_1_schema_items> | null;
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/sales-geography/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
  /**
   * Отчет по ключевым показателям
   * {% include notitle [access](../../_auto/method_scopes/generateKeyIndicatorsReport.md) %}
   *
   * Запускает генерацию **отчета по ключевым показателям**. [Что это за отчет](https://yandex.ru/support/marketplace/ru/analytics/key-metrics)
   *
   * Узнать статус генерации и получить ссылку на готовый отчет можно с помощью запроса [GET reports/info/{reportId}](../../reference/reports/getReportInfo.md).
   *
   * {% include notitle [reports](../../_auto/reports/key_indicators/key_indicators.md) %}
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @param requestBody
   * @param format Формат отчета.
   * @returns paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema В ответ приходит идентификатор, который позволяет узнавать статус генерации и скачать готовый отчет.
   * @throws ApiError
   */
  public static generateKeyIndicatorsReport(
    requestBody: {
      /**
       * Идентификатор кабинета.
       *
       * Указывается, если нужно составить отчет по всем магазинам в кабинете. В запросе обязательно должен быть либо `businessId`, либо `campaignId`, но не оба сразу.
       *
       */
      businessId?: number;
      /**
       * Идентификатор кампании.
       *
       * Указывается, если нужно составить отчет по конкретному магазину. В запросе обязательно должен быть либо `businessId`, либо `campaignId`, но не оба сразу.
       *
       * Его можно узнать с помощью запроса [GET campaigns](../../reference/campaigns/getCampaigns.md) или найти в кабинете продавца на Маркете — нажмите на название своего бизнеса и перейдите на страницу:
       *
       * * **Модули и API** → блок **Передача данных Маркету**.
       * * **Лог запросов** → выпадающий список в блоке **Показывать логи**.
       *
       * ⚠️ Не передавайте вместо него идентификатор магазина, который указан в кабинете продавца на Маркете рядом с названием магазина и в некоторых отчетах.
       *
       */
      campaignId?: number;
      /**
       * За какой период нужна детализация.
       */
      detalizationLevel: 'WEEK' | 'MONTH';
    },
    format: 'FILE' | 'CSV' | 'JSON' = 'FILE',
  ): CancelablePromise<paths_1reports_1prices_1generate_post_responses_200_content_application_1json_schema> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/reports/key-indicators/generate',
      query: {
        format: format,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Запрос содержит неправильные данные.`,
        401: `В запросе не указаны данные для авторизации.`,
        403: `Данные для авторизации неверны или доступ к ресурсу запрещен.`,
        420: `Превышено ограничение на доступ к ресурсу.`,
        500: `Внутренняя ошибка сервера.`,
      },
    });
  }
}
