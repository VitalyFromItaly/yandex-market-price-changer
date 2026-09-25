import type { IActionLogEntry } from '../../database/services/action-log.service';

import { maskSecrets, truncate } from '../telegram/bots/shared/action-log.domain';

/**
 * Журнал CRM: как запрос продавца ложится в тот же `actionlogs`, что и апдейты
 * бота. Чистая часть — без Nest и express, тестируется без сервера.
 *
 * Одна коллекция на оба канала — ради вопроса «что делал этот продавец»: ответ
 * должен быть одной лентой, а не двумя списками, сшиваемыми руками по времени.
 */

/** Префикс API CRM с учётом глобального `/api`. */
export const CRM_API_PREFIX = '/api/crm/';

/** `source` строк CRM — по нему панель ставит метку «CRM». */
export const CRM_SOURCE = 'crm';

/**
 * `botId` обязателен в схеме, а бота у CRM нет. Не `system` — тот значит «ни
 * от кого», а здесь тенант известен: это канал CRM.
 */
export const CRM_BOT_ID = 'crm';

export interface ICrmRequestFacts {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  telegramUserId?: string;
  username?: string;
  name?: string;
  error?: string;
}

/**
 * Строка журнала для одного запроса.
 *
 * Тело НЕ пишется никогда — в нём пароли входа и смены пароля. Адрес
 * маскируется так же, как текст бота: в query может оказаться что угодно.
 * Без продавца (неверный токен, неудачный вход) владелец — `system`, как у
 * HTTP-ошибок.
 */
export function crmLogEntry(facts: ICrmRequestFacts, systemUser: string): IActionLogEntry {
  const failed = facts.statusCode >= 400;
  return {
    telegramUserId: facts.telegramUserId ?? systemUser,
    username: facts.username,
    name: facts.name,
    botId: CRM_BOT_ID,
    direction: 'in',
    kind: 'request',
    action: truncate(maskSecrets(`${facts.method} ${facts.url}`)),
    status: failed ? 'error' : 'ok',
    durationMs: facts.durationMs,
    httpStatus: facts.statusCode,
    error: failed ? facts.error : undefined,
    source: CRM_SOURCE,
  };
}

/** Текст исключения для строки запроса — `message` у HttpException и у Error. */
export function errorMessageOf(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception);
}
