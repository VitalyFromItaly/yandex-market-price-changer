import type { IOzonCredentials } from './ozon.client';

/**
 * Проверка ФОРМЫ кредов Ozon до похода в Ozon — чистая, без Nest.
 *
 * Client-Id — положительное целое: на нечисловой Ozon отвечает 400 code 3
 * («Client-Id header value should be positive integer», живой запрос
 * 16-10-2026), и продавец получил бы «Ozon не отвечает» вместо подсказки под
 * полем. Api-Key проверяется мягко — без пробелов, не короче 16 символов: сейчас
 * это uuid, но жёсткий шаблон отверг бы рабочий ключ, как только Ozon сменит
 * формат, а решает о ключе всё равно сам Ozon.
 */

export type TOzonCredentialsField = 'clientId' | 'apiKey';

export type TOzonCredentialsParse =
  | { ok: true; credentials: IOzonCredentials }
  | { ok: false; field: TOzonCredentialsField; message: string };

export const OZON_CLIENT_ID_TEXT =
  'Client-Id — это число из личного кабинета Ozon (Настройки → Seller API).';
export const OZON_API_KEY_TEXT =
  'Api-Key — длинная строка без пробелов из личного кабинета Ozon (Настройки → Seller API).';

const CLIENT_ID = /^[1-9]\d{0,18}$/;
const API_KEY = /^\S{16,200}$/;

export function parseOzonCredentials(body: unknown): TOzonCredentialsParse {
  const input = (body ?? {}) as { clientId?: unknown; apiKey?: unknown };
  const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';

  if (!CLIENT_ID.test(clientId)) {
    return { ok: false, field: 'clientId', message: OZON_CLIENT_ID_TEXT };
  }
  if (!API_KEY.test(apiKey)) {
    return { ok: false, field: 'apiKey', message: OZON_API_KEY_TEXT };
  }
  return { ok: true, credentials: { clientId, apiKey } };
}
