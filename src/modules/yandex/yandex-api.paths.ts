/**
 * Пути Partner API — ЕДИНСТВЕННОЕ место, где они собираются.
 *
 * Версия в пути обязательна: неверсионированные запросы Яндекс отключает.
 * При этом версия относится к КОНКРЕТНОМУ МЕТОДУ — у разных методов актуальные
 * версии разные, поэтому «взять последнюю по умолчанию» здесь невозможно в
 * принципе. Каждая версия проставлена явно и живёт рядом со своим путём, чтобы
 * при обновлении одного метода не поехали остальные.
 *
 * Документация:
 * https://yandex.ru/dev/market/partner-api/doc/ru/reference/orders/getOrders
 * https://yandex.ru/dev/market/partner-api/doc/ru/reference/returns/getReturns
 */

export const API_VERSIONS = {
  orders: 'v2',
  returns: 'v2',
  campaigns: 'v2',
  /** История заказов глубже 30 дней — только через businesses и только v1. */
  businessOrders: 'v1',
} as const;

export function campaignsPath(): string {
  return `/${API_VERSIONS.campaigns}/campaigns`;
}

export function ordersPath(campaignId: string): string {
  return `/${API_VERSIONS.orders}/campaigns/${encodeURIComponent(campaignId)}/orders`;
}

export function returnsPath(campaignId: string): string {
  return `/${API_VERSIONS.returns}/campaigns/${encodeURIComponent(campaignId)}/returns`;
}

export function businessOrdersPath(businessId: string): string {
  return `/${API_VERSIONS.businessOrders}/businesses/${encodeURIComponent(businessId)}/orders`;
}

/**
 * Лимиты страницы у методов разные, и превышение — это 400, а не «молча
 * обрежем». Значения из документации, см. reference.partner_api в tasks.json.
 */
export const PAGE_LIMITS = {
  orders: { default: 50, max: 50 },
  returns: { default: 50, max: 100 },
} as const;

/** Окно истории getOrders. Диапазон шире — запрос отклоняется Яндексом. */
export const HISTORY_WINDOW_DAYS = 30;
