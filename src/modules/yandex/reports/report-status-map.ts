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
 * Статусы, которые Partner API принимает В ФИЛЬТРЕ `status`.
 *
 * Список короче enum'а, и это не описка. Проверено на боевом API 30-07-2026:
 * `PLACING`, `RESERVED`, `PENDING`, `PARTIALLY_RETURNED` и `UNKNOWN` дают
 * `400 BAD_REQUEST: Statuses [X] are not allowed` — и роняют ВЕСЬ отчёт, а не
 * отбрасывают один статус. Приходить в ответе они при этом могут: enum описывает
 * значения ответа, а этот список — то, что можно спросить.
 *
 * Раньше это не проявлялось: axios сериализовал массив как `status[]=...`,
 * Partner API такой параметр игнорировал, и запрещённые значения до него просто
 * не доезжали. TASK-054 научил клиент слать `status=` повторяющимся параметром —
 * фильтр заработал, и вместе с ним заработал этот отказ: отчёт «Едет обратно»
 * (в его определении стоит `PARTIALLY_RETURNED`) с тех пор отвечал
 * «Яндекс.Маркет отклонил запрос».
 */
export const QUERYABLE_STATUSES: readonly TOrderStatus[] = [
  ORDER_STATUS.UNPAID,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.DELIVERY,
  ORDER_STATUS.PICKUP,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.RETURNED,
];

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

export type TReturnSubstatus = (typeof RETURN_SUBSTATUS)[keyof typeof RETURN_SUBSTATUS];

/** Статус отгрузки возврата — для GET v2/campaigns/{id}/returns. */
export const RETURN_SHIPMENT_STATUS = {
  IN_TRANSIT: 'IN_TRANSIT',
} as const;

/**
 * Типы субсидий Маркета. Тоже перечисление Partner API, и живёт оно ЗДЕСЬ по той
 * же причине, что `RETURN_SHIPMENT_STATUS`: тест «статусы не размазаны по коду»
 * ловит литерал `'DELIVERY'` в любом другом файле — и правильно ловит, потому
 * что это ещё и статус заказа. Одна строка, два разных смысла.
 *
 * Дословно из документации `OrderSubsidyDTO`: «Общее ВОЗНАГРАЖДЕНИЕ ПАРТНЁРУ за
 * DBS-доставку и все скидки на товар: по промокодам, купонам и акциям; по баллам
 * Плюса; по доставке (DBS)». То есть это деньги, которые продавец ПОЛУЧАЕТ:
 * скидку по акции даёт Маркет и продавцу её компенсирует.
 */
export const SUBSIDY_TYPE = {
  /** Акции, промокоды, купоны. */
  SUBSIDY: 'SUBSIDY',
  /** Баллы Плюса. */
  YANDEX_CASHBACK: 'YANDEX_CASHBACK',
  /** Доставка DBS — не товарная выручка, см. subsidiesTotal в money.ts. */
  DELIVERY: 'DELIVERY',
} as const;

/**
 * Какой фильтр даты применяет отчёт. Это разные параметры с разным смыслом, и
 * подмена одного другим даёт правдоподобный, но неверный отчёт:
 *
 * - `supplierShipmentDate` — дата ОТГРУЗКИ в службу доставки (DD-MM-YYYY)
 * - `updatedAt` — любое ОБНОВЛЕНИЕ заказа (ISO 8601 со смещением)
 * - `creationDate` — дата ОФОРМЛЕНИЯ заказа, fromDate/toDate (DD-MM-YYYY)
 * - `none` — фильтра нет, берётся текущий срез
 */
export type TDateFilter = 'supplierShipmentDate' | 'updatedAt' | 'creationDate' | 'none';

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
  /** (д) Чистая прибыль по выкупленным заказам. */
  PROFIT: 'profit',
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

  [REPORT.PROFIT]: {
    title: 'Прибыль',
    // Тот же набор заказов, что у «Выкуплено», и это не совпадение: прибыль
    // считается по деньгам, которые продавец УЖЕ получил. Заказ в пути можно
    // не выкупить, и посчитанная по нему прибыль оказалась бы выдумкой.
    //
    // Определение продублировано, а не переиспользовано ссылкой на REDEEMED
    // намеренно: если завтра «Выкуплено» решат считать по другому фильтру даты,
    // прибыль не должна поехать за ним молча.
    statuses: [ORDER_STATUS.DELIVERED],
    substatuses: [],
    dateFilter: 'updatedAt',
    usesReturnsApi: false,
  },
};

export function reportDefinition(key: TReportKey): IReportDefinition {
  return REPORT_DEFINITIONS[key];
}

/**
 * Статусы определения, пригодные для ЗАПРОСА.
 *
 * Запрещённые Яндексом значения отбрасываются здесь, а не в определениях:
 * определение описывает, что входит в отчёт ПО СМЫСЛУ, и подстраивать смысл под
 * ограничение транспорта — верный способ однажды удалить статус и забыть, зачем
 * он был нужен. Отбор ответа (`matchesDefinition`) идёт по полному списку.
 *
 * Плата за это: заказы в незапрашиваемом статусе в ответ не придут вовсе. Для
 * «Едет обратно» это `PARTIALLY_RETURNED`; частичный возврат в пути всё равно
 * виден через метод возвратов (`usesReturnsApi`), поэтому дыра невелика —
 * а вот 400 на весь отчёт был бы полным отказом.
 */
export function queryStatuses(definition: IReportDefinition): TOrderStatus[] {
  return definition.statuses.filter((status) => QUERYABLE_STATUSES.includes(status));
}

/**
 * Заказы, ОФОРМЛЕННЫЕ за период. Не отчёт и не кнопка — второй набор внутри
 * прибыли.
 *
 * Ключа в `REPORT` намеренно НЕТ: `Object.values(REPORT)` питает
 * `OrderReportsService.keys`, то есть новый ключ означал бы новую кнопку отчёта
 * и новую строку в рассылке, которых никто не просил.
 *
 * Зачем этот набор вообще. Продавец сверяется с кабинетом, где видит
 * ОФОРМЛЕННЫЕ заказы, а прибыль считается по ВЫКУПЛЕННЫМ: 30-07-2026 это дало
 * 11 против 10 при дневной норме магазина 40–50, и расхождение выглядело
 * поломкой. Теперь обе цифры в одном сообщении.
 */
export const PLACED_STATUSES: readonly TOrderStatus[] = [
  // Недооформленные (PLACING, RESERVED) сюда не входят: заказа ещё нет.
  // UNPAID входит — это оформленный заказ с отложенным платежом, продавец
  // видит его в кабинете и считает своим.
  ORDER_STATUS.UNPAID,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.DELIVERY,
  ORDER_STATUS.PICKUP,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.PARTIALLY_RETURNED,
  ORDER_STATUS.RETURNED,
];

export const PLACED_DEFINITION: IReportDefinition = {
  title: 'Оформлено',
  // CANCELLED ЗАПРАШИВАЕТСЯ вместе с остальными, хотя в прибыль не идёт:
  // продавец в кабинете видит отменённые в общем списке, и без строки «ещё N
  // отменено» наша цифра оказалась бы меньше его — то самое расхождение,
  // ради которого всё и затевалось. Разделение — в ProfitService, одним
  // запросом вместо двух.
  statuses: [...PLACED_STATUSES, ORDER_STATUS.CANCELLED],
  substatuses: [],
  dateFilter: 'creationDate',
  usesReturnsApi: false,
};

/** Отменён ли заказ. Одна проверка на всех, а не сравнение строк по коду. */
export function isCancelled(order: { status?: string }): boolean {
  return order?.status === ORDER_STATUS.CANCELLED;
}

/**
 * Подходит ли заказ под отчёт. Логика отчётов зовёт ЭТО, а не сравнивает
 * строки у себя, — иначе маппинг снова расползётся по коду.
 */
export function matchesReport(
  key: TReportKey,
  order: { status?: string; substatus?: string },
): boolean {
  return matchesDefinition(REPORT_DEFINITIONS[key], order);
}

/**
 * То же по определению, а не по ключу: наборы вроде `PLACED_DEFINITION` ключа
 * не имеют. `matchesReport` оставлен обёрткой — логика подстатусов должна жить
 * в одном месте.
 */
export function matchesDefinition(
  definition: IReportDefinition,
  order: { status?: string; substatus?: string },
): boolean {
  if (!definition.statuses.includes(order?.status as TOrderStatus)) return false;

  // Пустой список подстатусов означает «подстатус не важен», а не «подстатус
  // должен отсутствовать».
  if (!definition.substatuses.length) return true;

  return definition.substatuses.includes(order?.substatus as TReturnSubstatus);
}
