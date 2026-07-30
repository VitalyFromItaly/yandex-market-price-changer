/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0 } from '../models/paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AuthService {
  /**
   * Получение информации об авторизационном токене
   * {% include notitle [access](../../_auto/method_scopes/getAuthTokenInfo.md) %}
   *
   * {% note info "Метод доступен только для Api-Key-токена." %}
   *
   *
   *
   * {% endnote %}
   *
   * Возвращает информацию о переданном авторизационном токене.
   *
   * |**⚙️ Лимит:** 100 запросов в час|
   * |-|
   *
   * @returns any Информация об авторизационном токене.
   * @throws ApiError
   */
  public static getAuthTokenInfo(): CancelablePromise<paths_1warehouses_get_responses_200_content_application_1json_schema_allOf_0> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/auth/token',
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
