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
  /** Каталог товаров продавца. Проверено на боевом аккаунте: v2 отвечает 200. */
  offerMappings: 'v2',
  /** Остатки. Проверено: v2 -> 200, v1 -> 404 Resource not found. */
  stocks: 'v2',
  /**
   * Склады: список складов Маркета (FBY) и складов магазина (FBS/DBS/Express).
   * Версия — v2, как и у остальных актуальных методов (campaigns/stocks/
   * offerMappings): вся модель Partner API переехала на v2 одновременно.
   */
  warehouses: 'v2',
  /**
   * Асинхронные отчёты (в т.ч. остатки FBY по типам: stocks-on-warehouses).
   * Проверено на боевом FBY-аккаунте: generate → v2 отвечает 200 и reportId.
   */
  reports: 'v2',
  /**
   * Заявки на поставку/вывоз/утилизацию FBY. Проверено на боевом:
   * v2 → 200, v1 → 404 Resource not found.
   */
  supplyRequests: 'v2',
  /**
   * Калькулятор стоимости услуг Маркета (POST tariffs/calculate).
   * Расчёт «примерный» по документации; лимит 100 запросов в минуту.
   */
  tariffs: 'v2',
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

/** Каталог товаров продавца (POST). Отдаёт offerId — это и есть артикул. */
export function offerMappingsPath(businessId: string): string {
  return `/${API_VERSIONS.offerMappings}/businesses/${encodeURIComponent(businessId)}/offer-mappings`;
}

/**
 * Склады Маркета (FBY), GET. Отдаёт идентификаторы и названия складов, на
 * которых Маркет хранит товар по модели FBY. Кампания/бизнес не нужны —
 * список общий для токена.
 */
export function fulfillmentWarehousesPath(): string {
  return `/${API_VERSIONS.warehouses}/warehouses`;
}

/**
 * Склады магазина (FBS/DBS/Express) и их группы, GET. В отличие от FBY,
 * привязаны к бизнесу продавца: возвращаются его собственные склады отгрузки.
 */
export function businessWarehousesPath(businessId: string): string {
  return `/${API_VERSIONS.warehouses}/businesses/${encodeURIComponent(businessId)}/warehouses`;
}

/**
 * Остатки. Один и тот же путь: POST — прочитать, PUT — записать.
 * PUT — ЕДИНСТВЕННАЯ операция записи во всём приложении (бот read-only,
 * см. TASK-036…043). Всё остальное только читает.
 */
export function stocksPath(campaignId: string): string {
  return `/${API_VERSIONS.stocks}/campaigns/${encodeURIComponent(campaignId)}/offers/stocks`;
}

/**
 * Генерация отчёта об остатках на складах (FBY), POST. Асинхронный: возвращает
 * reportId, статус и файл забираются через reportInfoPath. Единственный
 * источник остатков FBY по типам — синхронный offers/stocks для FBY отдаёт
 * пусто (проверено на боевом).
 */
export function stocksOnWarehousesGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/stocks-on-warehouses/generate`;
}

/** Статус и ссылка на готовый отчёт по его reportId, GET. */
export function reportInfoPath(reportId: string): string {
  return `/${API_VERSIONS.reports}/reports/info/${encodeURIComponent(reportId)}`;
}

/**
 * Заявки FBY (поставка/вывоз/утилизация), POST. Для сводки FBY фильтруем
 * WITHDRAW+UTILIZATION — то, что надо физически забрать со склада Маркета.
 */
export function supplyRequestsPath(campaignId: string): string {
  return `/${API_VERSIONS.supplyRequests}/campaigns/${encodeURIComponent(campaignId)}/supply-requests`;
}

/**
 * Калькулятор стоимости услуг (POST). В пути ни кампании, ни бизнеса:
 * campaignId уходит в ТЕЛЕ запроса, причём числом (int64 по спеке).
 */
export function tariffsCalculatePath(): string {
  return `/${API_VERSIONS.tariffs}/tariffs/calculate`;
}

/**
 * Лимиты страницы у методов разные, и превышение — это 400, а не «молча
 * обрежем». Значения из документации, см. reference.partner_api в tasks.json.
 */
export const PAGE_LIMITS = {
  orders: { default: 50, max: 50 },
  returns: { default: 50, max: 100 },
  /** Каталог: 200 на страницу. Каталог на 5.6k товаров — это 28 запросов. */
  offerMappings: { default: 200, max: 200 },
} as const;

/**
 * Размер батча при записи остатков. Яндекс принимает до 2000 позиций за
 * запрос, но берём с запасом: при отказе Яндекс не сообщает, какая именно
 * позиция виновата, — чем меньше батч, тем точнее локализуется проблема.
 */
export const STOCKS_BATCH_SIZE = 500;

/**
 * Сколько складов запросить, определяя склад ЗАПИСИ остатков.
 *
 * Не 1: в ответе `offers/stocks` рядом со складом магазина бывает чужой — склад
 * Маркета на FBY или склад возвратов на FBS, — и первым Яндекс может поставить
 * любой. Нужен весь список, чтобы пересечь его с собственными складами бизнеса
 * (см. `getWarehouseId`). Десяти хватает с запасом: своих складов у продавца
 * единицы, а страница здесь одна.
 */
export const WAREHOUSE_PROBE_LIMIT = 10;

/** Окно истории getOrders. Диапазон шире — запрос отклоняется Яндексом. */
export const HISTORY_WINDOW_DAYS = 30;

/**
 * Максимум товаров в одном запросе калькулятора тарифов. Это не лимит
 * страницы (пагинации у метода нет), а предел массива offers — превышение
 * отвечает 400.
 */
export const TARIFFS_MAX_OFFERS = 200;

/**
 * Максимум артикулов в фильтре `offerIds` метода offer-mappings.
 *
 * НЕ равен лимиту страницы (200): спека обещает те же 200, но боевой отвечает
 * `400: offerIds size must be between 1 and 100 (rejected size: 200)` —
 * проверено 04-08-2026 на бизнесе 164225008. Ещё один случай расхождения
 * спеки с боевым, как enum статусов заявок FBY.
 */
export const OFFER_IDS_BATCH = 100;
