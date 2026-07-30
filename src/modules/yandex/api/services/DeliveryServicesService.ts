/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DeliveryServicesService {
  /**
   * Справочник служб доставки
   * {% include notitle [access](../../_auto/method_scopes/getDeliveryServices.md) %}
   *
   * Возвращает справочник служб доставки: идентификаторы и наименования.
   * |**⚙️ Лимит:** 5 000 запросов в час|
   * |-|
   *
   * @returns any Информация о службах доставки.
   * @throws ApiError
   */
  public static getDeliveryServices(): CancelablePromise<{
    /**
     * Информация о службах доставки.
     */
    result?: {
      /**
       * Информация о службе доставки.
       */
      deliveryService: Array<{
        /**
         * Идентификатор службы доставки.
         */
        id: number;
        /**
         * Наименование службы доставки.
         */
        name: string;
      }>;
    };
  }> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/delivery/services',
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
