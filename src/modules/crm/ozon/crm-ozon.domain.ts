import type { IMarketplaceConnectionView } from '../../marketplaces/marketplace-connections.domain';

/** Коды ошибок `PUT /api/crm/ozon/connection` — фронт ставит их под поле или в тост. */
export const INVALID_OZON_KEY = 'INVALID_OZON_KEY';
export const OZON_KEY_REJECTED = 'OZON_KEY_REJECTED';
export const OZON_KEY_EMPTY = 'OZON_KEY_EMPTY';
export const OZON_UNAVAILABLE = 'OZON_UNAVAILABLE';

export const OZON_KEY_EMPTY_TEXT =
  'Ozon принял ключ, но у него нет ни одной роли — читать им нечего. Выпустите ключ ' +
  'с ролями в личном кабинете Ozon (Настройки → Seller API) и подключите его.';
export const OZON_UNAVAILABLE_TEXT =
  'Ozon сейчас не отвечает, ключ не проверен и не сохранён. Попробуйте через несколько минут.';

export interface ICrmOzonConnectionView {
  connection: IMarketplaceConnectionView;
}
