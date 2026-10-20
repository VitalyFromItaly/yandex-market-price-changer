/** Валюта, в которой цена уже в рублях: так её называет Partner API. */
export const BASE_CURRENCY = 'RUR';

/** Подписи валют формы; незнакомый код показывается как есть. */
export const CURRENCY_LABEL: Readonly<Record<string, string>> = {
  RUR: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥',
};

/** Ошибки сервера, которые форма ставит под поле. */
export const PRODUCT_ERROR_CODE = {
  INVALID_PURCHASE: 'INVALID_PURCHASE',
  INVALID_LINK: 'INVALID_LINK',
} as const;
