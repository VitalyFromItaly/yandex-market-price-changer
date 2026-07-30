/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TariffsService {
  /**
   * Калькулятор стоимости услуг
   * {% include notitle [access](../../_auto/method_scopes/calculateTariffs.md) %}
   *
   * Рассчитывает стоимость услуг Маркета для товаров с заданными параметрами. Порядок товаров в запросе и ответе сохраняется, чтобы определить,
   * для какого товара рассчитана стоимость услуги.
   *
   * Обратите внимание: калькулятор осуществляет примерные расчеты. Финальная стоимость для каждого заказа зависит от предоставленных услуг.
   *
   * В запросе можно указать либо параметр `campaignId`, либо `sellingProgram`. Совместное использование параметров приведет к ошибке.
   *
   * |**⚙️ Лимит:** 100 запросов в минуту|
   * |-|
   *
   * @param requestBody
   * @returns any Стоимость услуг.
   * @throws ApiError
   */
  public static calculateTariffs(requestBody: {
    /**
     * Параметры для расчета стоимости услуг.
     */
    parameters: {
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
       * У пользователя, который выполняет запрос, должен быть доступ к этой кампании.
       *
       * Используйте параметр `campaignId`, если уже завершили подключение магазина на Маркете. Иначе вернется пустой список.
       *
       * Обязательный параметр, если не указан параметр `sellingProgram`. Совместное использование параметров приведет к ошибке.
       *
       */
      campaignId?: number;
      /**
       * Модель размещения.
       *
       * Обязательный параметр, если не указан параметр `campaignId`. Совместное использование параметров приведет к ошибке.
       *
       */
      sellingProgram?: 'FBY' | 'FBS' | 'DBS' | 'EXPRESS';
      /**
       * Частота выплат.
       */
      frequency?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
    };
    /**
     * Товары, для которых нужно рассчитать стоимость услуг.
     */
    offers: Array<{
      /**
       * Идентификатор категории товара на Маркете.
       *
       * Для расчета стоимости услуг необходимо указать идентификатор листовой категории товара — той, которая не имеет дочерних категорий.
       *
       * Чтобы узнать идентификатор категории, к которой относится товар, воспользуйтесь запросом [POST categories/tree](../../reference/categories/getCategoriesTree.md).
       *
       */
      categoryId: number;
      /**
       * Цена на товар в рублях.
       */
      price: number;
      /**
       * Длина товара в сантиметрах.
       */
      length: number;
      /**
       * Ширина товара в сантиметрах.
       */
      width: number;
      /**
       * Высота товара в сантиметрах.
       */
      height: number;
      /**
       * Вес товара в килограммах.
       */
      weight: number;
      /**
       * Квант продажи — количество единиц товара в одном товарном предложении.
       */
      quantity?: number;
    }>;
  }): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/tariffs/calculate',
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
