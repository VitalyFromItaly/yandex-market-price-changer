/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CategoriesService {
  /**
   * Дерево категорий
   * {% include notitle [access](../../_auto/method_scopes/getCategoriesTree.md) %}
   *
   * Возвращает дерево категорий Маркета.
   *
   * |**⚙️ Лимит:** 1 000 запросов в час|
   * |-|
   *
   * @param requestBody
   * @returns any Категории Маркета.
   * @throws ApiError
   */
  public static getCategoriesTree(requestBody?: {
    /**
     * Язык категорий.
     */
    language?: 'RU' | 'EN';
  }): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/categories/tree',
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
   * Лимит на установку кванта продажи и минимального количества товаров в заказе
   * {% include notitle [access](../../_auto/method_scopes/getCategoriesMaxSaleQuantum.md) %}
   *
   * Возвращает лимит на установку [кванта](*quantum) и минимального количества товаров в заказе, которые вы можете задать для товаров указанных категорий.
   *
   * Если вы передадите значение кванта или минимального количества товаров выше установленного Маркетом ограничения, товар будет скрыт с витрины.
   *
   * Подробнее о том, как продавать товары по несколько штук, читайте [в Справке Маркета для продавцов](https://yandex.ru/support2/marketplace/ru/assortment/fields/quantum).
   *
   * |**⚙️ Лимит:** 5 000 запросов в час|
   * |-|
   *
   * @param requestBody
   * @returns any Лимит на установку кванта и минимального количества товаров.
   * @throws ApiError
   */
  public static getCategoriesMaxSaleQuantum(requestBody: {
    /**
     * Идентификаторы листовых категории на Маркете — тех, у которых нет дочерних категорий.
     */
    marketCategoryIds: Array<number>;
  }): CancelablePromise<
    paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 & {
      /**
       * Категории и лимит на установку кванта и минимального количества товаров.
       */
      results: Array<{
        /**
         * Идентификатор категории.
         */
        id: number;
        /**
         * Название категории.
         */
        name?: string;
        /**
         * Лимит на установку кванта и минимального количества товаров.
         */
        maxSaleQuantum?: number;
      }>;
      /**
       * Ошибки, которые появились из-за переданных категорий.
       */
      errors?: Array<{
        /**
         * Идентификатор категории.
         */
        categoryId?: number;
        /**
         * Типы ошибок:
         *
         * * `UNKNOWN_CATEGORY` — указана неизвестная категория.
         * * `CATEGORY_IS_NOT_LEAF` — указана нелистовая категория. Укажите ту, которая не имеет дочерних категорий.
         *
         */
        type?: 'UNKNOWN_CATEGORY' | 'CATEGORY_IS_NOT_LEAF';
      }> | null;
    }
  > {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/categories/max-sale-quantum',
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
