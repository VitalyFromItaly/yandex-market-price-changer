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
  /**
   * Архив заказов глубже 30 дней — POST stats/orders. Прежняя декларация
   * `businessOrders: 'v1'` удалена: эндпоинта `POST /v1/businesses/{id}/orders`
   * в спеке Partner API НЕ существует (проверено по openapi 08-08-2026), это
   * был миф. Сверить v2 на боевом при первом включении фичи deep_history.
   */
  ordersStats: 'v2',
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
  /**
   * Карантин цен: список и подтверждение. v2 — как у остальных актуальных
   * business-методов (offerMappings, warehouses); сверить на боевом при
   * первом включении фичи.
   */
  priceQuarantine: 'v2',
  /** Отзывы о товарах: список, ответ, «прочитано». */
  goodsFeedback: 'v2',
  /** Рекомендации Маркета по ценам (offers/recommendations). */
  offerRecommendations: 'v2',
  /**
   * Заполненность карточек (offer-cards). v2 по аналогии с остальными
   * business-методами; сверить на боевом при первом включении фичи.
   */
  offerCards: 'v2',
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

/**
 * Архив заказов (POST) — глубже 30-дневного окна getOrders. Форма заказа
 * ДРУГАЯ (OrdersStatsOrderDTO), в отчёты она попадает только через маппер
 * `reports/stats-orders.ts`. Данные могут отставать до 40 минут.
 */
export function ordersStatsPath(campaignId: string): string {
  return `/${API_VERSIONS.ordersStats}/campaigns/${encodeURIComponent(campaignId)}/stats/orders`;
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
 * Долгое время PUT был единственной операцией записи во всём приложении;
 * теперь мутирующих операций четыре: этот PUT плюс три POST через `postWrite`
 * (подтверждение карантина, ответ на отзыв, «прочитано» у отзыва). Все прочие
 * методы только читают.
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
 * Карантин цен кабинета (POST — чтение со страницами). Товар попадает сюда,
 * когда цена изменилась слишком резко или сильно ниже рыночной, — и Маркет
 * ПРЯЧЕТ его с витрины, не сообщая продавцу иначе как в кабинете.
 */
export function priceQuarantinePath(businessId: string): string {
  return `/${API_VERSIONS.priceQuarantine}/businesses/${encodeURIComponent(businessId)}/price-quarantine`;
}

/** Подтверждение цен из карантина (POST — ЗАПИСЬ, идёт через postWrite). */
export function priceQuarantineConfirmPath(businessId: string): string {
  return `/${API_VERSIONS.priceQuarantine}/businesses/${encodeURIComponent(businessId)}/price-quarantine/confirm`;
}

/** Отзывы о товарах кабинета (POST — чтение со страницами). */
export function goodsFeedbackPath(businessId: string): string {
  return `/${API_VERSIONS.goodsFeedback}/businesses/${encodeURIComponent(businessId)}/goods-feedback`;
}

/** Ответ на отзыв (POST — ЗАПИСЬ, публичный комментарий на Маркете). */
export function goodsFeedbackCommentUpdatePath(businessId: string): string {
  return `/${API_VERSIONS.goodsFeedback}/businesses/${encodeURIComponent(businessId)}/goods-feedback/comments/update`;
}

/** Пометить отзывы прочитанными без ответа (POST — ЗАПИСЬ). */
export function goodsFeedbackSkipReactionPath(businessId: string): string {
  return `/${API_VERSIONS.goodsFeedback}/businesses/${encodeURIComponent(businessId)}/goods-feedback/skip-reaction`;
}

/**
 * Генерация отчёта по платежам (united-netting), POST. Асинхронный, как
 * stocks-on-warehouses: reportId → getReportInfo → скачивание файла.
 */
export function unitedNettingGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/united-netting/generate`;
}

// --- шесть отчётов раздела «📈 Отчёты Маркета» -------------------------------
//
// Все асинхронные (generate → reports/info → файл), все на версии reports.
// Тела запросов РАЗНОРОДНЫ (см. market-reports.service): реализация хочет
// год+месяц, конкурентная позиция — категорию, у ключевых показателей дат нет.

/** Отчёт по реализации (помесячный, бухгалтерский). Лимит 100/час. */
export function goodsRealizationGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/goods-realization/generate`;
}

/** Оборачиваемость (только FBY, на дату). Лимит 100/час. */
export function goodsTurnoverGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/goods-turnover/generate`;
}

/** Конкурентная позиция (по одной категории). Лимит 10/час. */
export function competitorsPositionGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/competitors-position/generate`;
}

/** Аналитика продаж (показы/продажи, группировка). Лимит 10/час. */
export function showsSalesGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/shows-sales/generate`;
}

/** Ключевые показатели (детализация WEEK/MONTH, дат нет). Лимит 100/час. */
export function keyIndicatorsGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/key-indicators/generate`;
}

/** География продаж. Лимит 100/час. */
export function salesGeographyGeneratePath(): string {
  return `/${API_VERSIONS.reports}/reports/sales-geography/generate`;
}

/**
 * Рекомендации Маркета по ценам (POST — чтение со страницами). Ответ несёт и
 * текущую цену каталога, и пороги привлекательной/умеренной — отдельная сверка
 * с offer-prices не нужна.
 */
export function offerRecommendationsPath(businessId: string): string {
  return `/${API_VERSIONS.offerRecommendations}/businesses/${encodeURIComponent(businessId)}/offers/recommendations`;
}

/**
 * Заполненность карточек товаров (POST — чтение со страницами): статус,
 * рейтинг заполненности и рекомендации Маркета по каждой карточке.
 */
export function offerCardsPath(businessId: string): string {
  return `/${API_VERSIONS.offerCards}/businesses/${encodeURIComponent(businessId)}/offer-cards`;
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
  /** Архив stats/orders: до 200 заказов в ответе по спеке. */
  ordersStats: { default: 200, max: 200 },
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
 * Максимум артикулов в одном подтверждении карантина. Спека: «не более 200
 * товаров в одном запросе», превышение — 400 на весь батч.
 */
export const QUARANTINE_CONFIRM_BATCH = 200;

/** Лимит страницы карантина по спеке — до 500 товаров в запросе. */
export const QUARANTINE_PAGE_LIMIT = 500;

/** Лимит страницы отзывов по спеке — не более 50 на страницу. */
export const FEEDBACK_PAGE_LIMIT = 50;

/**
 * Лимит страницы рекомендаций по ценам. В спеке лимит явно не назван (общий
 * PageLimit); 200 — по аналогии с offer-mappings, сверить на боевом.
 */
export const RECOMMENDATIONS_PAGE_LIMIT = 200;

/**
 * Лимит страницы offer-cards. В спеке общий PageLimit без числа; 200 — по
 * аналогии с offer-mappings, сверить на боевом (прецедент
 * RECOMMENDATIONS_PAGE_LIMIT).
 */
export const OFFER_CARDS_PAGE_LIMIT = 200;

/**
 * Максимум артикулов в фильтре `offerIds` метода offer-mappings.
 *
 * НЕ равен лимиту страницы (200): спека обещает те же 200, но боевой отвечает
 * `400: offerIds size must be between 1 and 100 (rejected size: 200)` —
 * проверено 04-08-2026 на бизнесе 164225008. Ещё один случай расхождения
 * спеки с боевым, как enum статусов заявок FBY.
 */
export const OFFER_IDS_BATCH = 100;
