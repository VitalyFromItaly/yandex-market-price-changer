/**
 * ЕДИНСТВЕННЫЙ источник правды о том, какие статусы и какой фильтр даты
 * соответствуют каждому отчёту.
 *
 * Зачем отдельным файлом. Статусы Partner API — знание предметной области, а не
 * логики: заказчик может сказать «в „едет обратно“ добавьте ещё один подстатус»,
 * и это правка одной строки здесь, а не четырёх мест в коде отчётов. Ровно так
 * же и по той же причине появился menu.constants.ts: строковый литерал,
 * размноженный по коду, расходится молча — ни компилятор, ни ревью этого
 * не ловят.
 *
 * Документация:
 * https://yandex.ru/dev/market/partner-api/doc/ru/reference/orders/getOrders
 */

/** Статусы заказа. Полный перечень Partner API. */
export const ORDER_STATUS = {
  PLACING: 'PLACING',
  RESERVED: 'RESERVED',
  UNPAID: 'UNPAID',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  DELIVERY: 'DELIVERY',
  PICKUP: 'PICKUP',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED',
  RETURNED: 'RETURNED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type TOrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * Подстатусы, по которым определяется «едет обратно».
 *
 * ⚠️ DELIVERY_SERIVCE_UNDELIVERED — НЕ опечатка в нашем коде. Опечатка живёт в
 * самом Partner API, причём там существуют ОБА варианта написания: исходный с
 * перестановкой букв (SERIVCE) и позднее добавленный правильный (SERVICE).
 * Яндекс присылает то один, то другой в зависимости от возраста заказа, и
 * матчить обязательно оба — иначе часть невыкупов молча выпадет из отчёта, а
 * выглядеть это будет как «у продавца просто нет возвратов».
 * Не «исправлять».
 */
export const RETURN_SUBSTATUS = {
  COURIER_RETURNS_ORDER: 'COURIER_RETURNS_ORDER',
  COURIER_RETURNED_ORDER: 'COURIER_RETURNED_ORDER',
  /** Опечатка Partner API — оставить как есть. */
  DELIVERY_SERIVCE_UNDELIVERED: 'DELIVERY_SERIVCE_UNDELIVERED',
  /** Исправленный вариант того же подстатуса — тоже приходит. */
  DELIVERY_SERVICE_UNDELIVERED: 'DELIVERY_SERVICE_UNDELIVERED',
  FULL_NOT_RANSOM: 'FULL_NOT_RANSOM',
} as const;

export type TReturnSubstatus =
  (typeof RETURN_SUBSTATUS)[keyof typeof RETURN_SUBSTATUS];

/** Статус отгрузки возврата — для GET v2/campaigns/{id}/returns. */
export const RETURN_SHIPMENT_STATUS = {
  IN_TRANSIT: 'IN_TRANSIT',
} as const;

/**
 * Какой фильтр даты применяет отчёт. Это разные параметры с разным смыслом, и
 * подмена одного другим даёт правдоподобный, но неверный отчёт:
 *
 * - `supplierShipmentDate` — дата ОТГРУЗКИ в службу доставки (DD-MM-YYYY)
 * - `updatedAt` — любое ОБНОВЛЕНИЕ заказа (ISO 8601 со смещением)
 * - `none` — фильтра нет, берётся текущий срез
 */
export type TDateFilter = 'supplierShipmentDate' | 'updatedAt' | 'none';

export interface IReportDefinition {
  /** Человеческое название — оно же заголовок сообщения. */
  readonly title: string;
  /** Статусы заказов, попадающих в отчёт. */
  readonly statuses: readonly TOrderStatus[];
  /** Подстатусы; пустой список означает «подстатус не важен». */
  readonly substatuses: readonly TReturnSubstatus[];
  readonly dateFilter: TDateFilter;
  /** Нужно ли дополнительно опрашивать метод возвратов. */
  readonly usesReturnsApi: boolean;
}

export const REPORT = {
  /** (а) Уехало клиенту за сегодня. */
  SHIPPED_TODAY: 'shipped_today',
  /** (б) Выкуплено за сегодня. */
  REDEEMED: 'redeemed',
  /** (в) Едет обратно: возвраты и невыкупы. */
  RETURNING: 'returning',
  /** (г) Всё, что едет до клиента — выгрузка .xlsx. */
  IN_TRANSIT: 'in_transit',
} as const;

export type TReportKey = (typeof REPORT)[keyof typeof REPORT];

export const REPORT_DEFINITIONS: Readonly<Record<TReportKey, IReportDefinition>> = {
  [REPORT.SHIPPED_TODAY]: {
    title: 'Уехало клиенту',
    statuses: [ORDER_STATUS.DELIVERY],
    substatuses: [],
    // Именно дата отгрузки: заказ мог быть создан неделю назад, а уехать
    // сегодня — фильтр по дате создания дал бы совсем другой список.
    dateFilter: 'supplierShipmentDate',
    usesReturnsApi: false,
  },

  [REPORT.REDEEMED]: {
    title: 'Выкуплено',
    statuses: [ORDER_STATUS.DELIVERED],
    substatuses: [],
    // Выкуп — это смена статуса, то есть обновление заказа. Даты создания и
    // отгрузки здесь ни при чём.
    dateFilter: 'updatedAt',
    usesReturnsApi: false,
  },

  [REPORT.RETURNING]: {
    title: 'Едет обратно',
    // Невыкуп отражается подстатусом, а сам заказ при этом остаётся в DELIVERY
    // или уже перешёл в RETURNED — поэтому берём оба.
    statuses: [ORDER_STATUS.DELIVERY, ORDER_STATUS.RETURNED, ORDER_STATUS.PARTIALLY_RETURNED],
    substatuses: [
      RETURN_SUBSTATUS.COURIER_RETURNS_ORDER,
      RETURN_SUBSTATUS.COURIER_RETURNED_ORDER,
      RETURN_SUBSTATUS.DELIVERY_SERIVCE_UNDELIVERED,
      RETURN_SUBSTATUS.DELIVERY_SERVICE_UNDELIVERED,
      RETURN_SUBSTATUS.FULL_NOT_RANSOM,
    ],
    dateFilter: 'updatedAt',
    usesReturnsApi: true,
  },

  [REPORT.IN_TRANSIT]: {
    title: 'Едет до клиента',
    statuses: [ORDER_STATUS.PROCESSING, ORDER_STATUS.DELIVERY, ORDER_STATUS.PICKUP],
    substatuses: [],
    // Это срез «что сейчас в пути», а не события за период — фильтра даты нет.
    dateFilter: 'none',
    usesReturnsApi: false,
  },
};

export function reportDefinition(key: TReportKey): IReportDefinition {
  return REPORT_DEFINITIONS[key];
}

/**
 * Подходит ли заказ под отчёт. Логика отчётов зовёт ЭТО, а не сравнивает
 * строки у себя, — иначе маппинг снова расползётся по коду.
 */
export function matchesReport(
  key: TReportKey,
  order: { status?: string; substatus?: string },
): boolean {
  const definition = REPORT_DEFINITIONS[key];

  if (!definition.statuses.includes(order?.status as TOrderStatus)) return false;

  // Пустой список подстатусов означает «подстатус не важен», а не «подстатус
  // должен отсутствовать».
  if (!definition.substatuses.length) return true;

  return definition.substatuses.includes(order?.substatus as TReturnSubstatus);
}
