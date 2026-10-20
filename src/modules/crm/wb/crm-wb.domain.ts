/** Коды ошибок `PUT /api/crm/wb/connection` — фронт ставит их под поле или в тост. */
export const INVALID_WB_TOKEN = 'INVALID_WB_TOKEN';
export const WB_TOKEN_REJECTED = 'WB_TOKEN_REJECTED';
export const WB_TOKEN_SCOPES = 'WB_TOKEN_SCOPES';
export const WB_UNAVAILABLE = 'WB_UNAVAILABLE';

export const WB_UNAVAILABLE_TEXT =
  'Wildberries сейчас не отвечает, токен не проверен и не сохранён. Попробуйте через несколько минут.';
