/**
 * Расчёт чистой прибыли.
 *
 * ЧИСТЫЙ модуль: ни telegraf, ни Mongo, ни сети — только арифметика, поэтому
 * проверяется обычными юнит-тестами. Рядом и по той же причине живут money.ts,
 * report-period.ts и report-status-map.ts.
 *
 * ФОРМУЛА, дословно как её задал заказчик:
 *
 *   «сначала от суммы продажи отнять 23 %, и потом от всей суммы 7 % налог,
 *    − закуп, и вот чистая»
 *
 * То есть ОБА процента считаются от суммы продажи, а не последовательно:
 *
 *   чистая = продажа − продажа×комиссия% − продажа×налог% − закуп
 *
 * При ставках по умолчанию это `продажа × 0,70 − закуп`. Налог берётся с
 * выручки — так работает УСН, — а не с остатка после комиссии. Разница на
 * десятке тысяч: 700 ₽ против 539 ₽, и оба варианта выглядят правдоподобно,
 * поэтому база налога зафиксирована здесь комментарием, а не в чьей-то памяти.
 *
 * Сумма продажи — `itemsTotal` заказа, только товары. Доставку платит
 * покупатель, она не выручка продавца. Это же число уже показано в отчётах
 * строкой «Товары», значит цифры между отчётами сходятся; взять вместо него
 * `Σ(item.price × count)` было бы ошибкой — цена позиции не включает
 * компенсацию субсидий и со строкой «Товары» не сойдётся.
 */

import { orderTotals, type IOrderMoney } from './money';

/**
 * Ставки по умолчанию.
 *
 * Объявлены ОДИН раз и отсюда же импортируются схемой (`@Prop({ default })`) и
 * интерфейсом. Дефолт `priceCoefficient` в этом проекте разъехался по четырём
 * местам (схема 1.2, фолбэк 2, процессор 2, текст меню) именно потому, что был
 * написан литералом в каждом.
 */
export const DEFAULT_COMMISSION_PERCENT = 23;
export const DEFAULT_TAX_PERCENT = 7;

/**
 * Скидки от прайса поставщика.
 *
 * В прайсе стоит НЕ закупочная цена, а цена поставщика; закуп — это она минус
 * согласованная скидка. По «Востоку» скидка своя, 4 %, по остальному — 10 %.
 * Проверено на боевых данных: без скидок месяц выходил с убытком, потому что
 * «закуп» составлял 75,8 % выручки.
 *
 * Скидка применяется при РАСЧЁТЕ, а не при сохранении цены: в базе лежит цена
 * ровно как в прайсе. Иначе смена процента требовала бы перезагрузки файла, а
 * заказчик просил их регулировать.
 */
export const DEFAULT_VOSTOK_DISCOUNT_PERCENT = 4;
export const DEFAULT_DISCOUNT_PERCENT = 10;

/** Разумные границы ставки. Процент вне них — почти наверняка опечатка. */
export const MIN_RATE_PERCENT = 0;
export const MAX_RATE_PERCENT = 100;

export interface IProfitRates {
  /** Комиссия Яндекс.Маркета, %. */
  commissionPercent: number;
  /** Налог с продаж, %. */
  taxPercent: number;
  /** Скидка от прайса по «Востоку», %. */
  vostokDiscountPercent: number;
  /** Скидка от прайса по всему остальному, %. */
  discountPercent: number;
}

export const DEFAULT_RATES: IProfitRates = {
  commissionPercent: DEFAULT_COMMISSION_PERCENT,
  taxPercent: DEFAULT_TAX_PERCENT,
  vostokDiscountPercent: DEFAULT_VOSTOK_DISCOUNT_PERCENT,
  discountPercent: DEFAULT_DISCOUNT_PERCENT,
};

/** Группа скидки. Их две, и обе видны продавцу в отчёте. */
export type TDiscountGroup = 'vostok' | 'other';

/**
 * Что считается «Востоком».
 *
 * Все три — Чистопольский часовой завод, то есть один поставщик и одна
 * договорённость по скидке: категории прайса «Восток» (360 позиций),
 * «Командирские» (147) и «Партнер» (2). Список ЕДИНСТВЕННОЕ место, где это
 * решается: если скидка 4 % относится только к категории «Восток», убрать отсюда
 * две строки — и всё.
 *
 * Сверяется и с категорией, и с наименованием: «Амфибия» отдельной категорией не
 * идёт, она внутри «Востока», зато в названии видна.
 */
export const VOSTOK_MARKERS: readonly string[] = [
  'восток',
  'командирские',
  'амфибия',
  'партнер',
  'партнёр',
];

/** Строка закупа, как она лежит в базе: цена ПРАЙСА плюс её происхождение. */
export interface IPurchaseRow {
  price: number;
  name?: string;
  category?: string;
}

/**
 * К какой скидке относится позиция.
 *
 * Определяется по сохранённым названию и категории, а не по отдельному полю в
 * базе: правило брендов живёт в коде, и его правка не должна требовать
 * перезагрузки прайса.
 */
export function discountGroup(row: IPurchaseRow): TDiscountGroup {
  const haystack = `${row?.category ?? ''} ${row?.name ?? ''}`.toLowerCase();
  return VOSTOK_MARKERS.some((marker) => haystack.includes(marker)) ? 'vostok' : 'other';
}

/** Закуп одной позиции: цена прайса минус скидка своей группы. */
export function purchaseCost(row: IPurchaseRow, rates: IProfitRates = DEFAULT_RATES): number {
  const percent =
    discountGroup(row) === 'vostok'
      ? normalizeRate(rates?.vostokDiscountPercent, DEFAULT_VOSTOK_DISCOUNT_PERCENT)
      : normalizeRate(rates?.discountPercent, DEFAULT_DISCOUNT_PERCENT);

  return amount(row?.price) * (1 - percent / 100);
}

/**
 * Цены прайса → закуп по каждому артикулу.
 *
 * Отдельным шагом, а не внутри profitOf: скидка — это свойство строки прайса, а
 * не заказа, и считать её на каждое вхождение товара в заказ незачем.
 */
export function applyDiscounts(
  rows: Map<string, IPurchaseRow>,
  rates: IProfitRates = DEFAULT_RATES,
): Map<string, number> {
  const costs = new Map<string, number>();

  for (const [sku, row] of rows) {
    costs.set(sku, purchaseCost(row, rates));
  }

  return costs;
}

/** Позиция заказа в объёме, нужном для закупа. */
export interface IProfitOrderItem {
  /** Артикул каталога. Тот же, по которому лежит закупочная цена. */
  offerId?: string;
  count?: number;
}

/** Заказ в объёме, нужном для прибыли. */
export interface IProfitOrder extends IOrderMoney {
  id?: number;
  items?: readonly IProfitOrderItem[];
}

/**
 * Заказы с возвратом — идентификаторами.
 *
 * Возврат ПОСЛЕ выкупа заказ из статуса `DELIVERED` не выводит: он живёт
 * отдельной сущностью в методе возвратов. Без этого набора выкупленный и тут же
 * возвращённый заказ так и остался бы в прибыли — деньги вернулись покупателю, а
 * отчёт считал бы их полученными.
 */
export type TReturnedOrders = ReadonlySet<number | string>;

export interface IProfitOptions {
  /** Идентификаторы заказов, по которым есть возврат. */
  returned?: TReturnedOrders;
}

/** Есть ли по заказу возврат. Сравнение и числом, и строкой: id приходит по-разному. */
function isReturned(order: IProfitOrder, returned?: TReturnedOrders): boolean {
  if (!returned?.size || order?.id == null) return false;
  return returned.has(order.id) || returned.has(String(order.id));
}

export interface IProfitTotals {
  /** Сумма продажи — только товары. */
  revenue: number;
  commission: number;
  tax: number;
  purchase: number;
  /** Чистая. Может быть отрицательной — это результат, а не сбой. */
  net: number;
  /** Заказов в расчёте. */
  orders: number;
  /** Заказы, выкинутые из расчёта: закуп известен не по всем позициям. */
  excludedOrders: number;
  excludedRevenue: number;
  /** Артикулы без закупа — их продавцу и надо дозаполнить. */
  unknownSkus: string[];
  /** Заказы с возвратом: исключены целиком — товар вернулся, денег нет. */
  returnedOrders: number;
  returnedRevenue: number;
  rates: IProfitRates;
}

/** Число или мусор → число. `null`, `undefined` и NaN дают 0, а не NaN дальше. */
function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ставка, приведённая к пригодной для счёта.
 *
 * В базе может лежать что угодно: документ заведён до появления поля, значение
 * правили руками. Неизвестное — это дефолт, а не падение отчёта; ровно так же
 * поступает `schedulePeriod` с сохранённым периодом.
 */
export function normalizeRate(value: unknown, fallback: number): number {
  // `null` и пустая строка проверяются ОТДЕЛЬНО: Number(null) === 0, то есть
  // «ставки нет» превратилось бы в «комиссия ноль процентов» — правдоподобное
  // число, завышающее прибыль почти на четверть.
  if (value === null || value === undefined || value === '') return fallback;

  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < MIN_RATE_PERCENT || n > MAX_RATE_PERCENT) return fallback;

  return n;
}

/** Ставки продавца из документа магазина. */
export function ratesOf(store: {
  commissionPercent?: number;
  taxPercent?: number;
  vostokDiscountPercent?: number;
  discountPercent?: number;
}): IProfitRates {
  return {
    commissionPercent: normalizeRate(store?.commissionPercent, DEFAULT_COMMISSION_PERCENT),
    taxPercent: normalizeRate(store?.taxPercent, DEFAULT_TAX_PERCENT),
    vostokDiscountPercent: normalizeRate(
      store?.vostokDiscountPercent,
      DEFAULT_VOSTOK_DISCOUNT_PERCENT,
    ),
    discountPercent: normalizeRate(store?.discountPercent, DEFAULT_DISCOUNT_PERCENT),
  };
}

/** Все артикулы, встречающиеся в позициях заказов. */
export function orderSkus(orders: readonly IProfitOrder[]): string[] {
  const skus = new Set<string>();

  for (const order of orders) {
    for (const item of order?.items ?? []) {
      if (item?.offerId) skus.add(item.offerId);
    }
  }

  return [...skus];
}

/**
 * Закуп по заказу или `null`, если он неизвестен хотя бы по одной позиции.
 *
 * `null`, а не 0: нулевой закуп означал бы «товар достался бесплатно» и молча
 * завысил бы прибыль. По решению заказчика такой заказ целиком выпадает из
 * расчёта и попадает в отдельную строку отчёта.
 *
 * Заказ вообще без позиций — тоже `null`: считать по нему прибыль нечем.
 */
export function orderPurchase(order: IProfitOrder, costs: Map<string, number>): number | null {
  const items = order?.items ?? [];
  if (!items.length) return null;

  let purchase = 0;

  for (const item of items) {
    const sku = item?.offerId;
    // Позиция без артикула тоже неизвестна: сопоставить её с прайсом нечем.
    const cost = sku ? costs.get(sku) : undefined;
    if (cost === undefined) return null;

    // Количество по документации обязательно, но ответ бывает неполным. Одна
    // штука — наименьшее непротиворечивое допущение: позиция в заказе есть.
    const count = amount(item.count) || 1;
    purchase += cost * count;
  }

  return purchase;
}

/**
 * Прибыль по набору заказов.
 *
 * Округлений внутри НЕТ: копейки живут до самого вывода, где `formatRubles`
 * округляет до рубля один раз. Промежуточное округление на четырёх слагаемых
 * даёт расхождение с кабинетом на рубли — при том, что каждое отдельное число
 * выглядит правильным.
 */
export function profitOf(
  orders: readonly IProfitOrder[],
  costs: Map<string, number>,
  rates: IProfitRates = DEFAULT_RATES,
  options: IProfitOptions = {},
): IProfitTotals {
  // Через ratesOf — один и тот же путь приведения для всех четырёх процентов,
  // включая скидки, которые здесь не считаются, но печатаются в отчёте.
  const normalized = ratesOf(rates ?? {});
  const { commissionPercent, taxPercent } = normalized;

  let revenue = 0;
  let purchase = 0;
  let counted = 0;
  let excludedOrders = 0;
  let excludedRevenue = 0;
  let returnedOrders = 0;
  let returnedRevenue = 0;
  const unknown = new Set<string>();

  for (const order of orders ?? []) {
    // Выручка — itemsTotal, ровно та же величина, что в строке «Товары».
    const orderRevenue = orderTotals(order).items;

    // Возврат проверяется ПЕРВЫМ и уводит заказ целиком: товар вернулся на склад,
    // значит нет ни выручки, ни комиссии, ни налога, ни закупа. Порядок важен —
    // иначе заказ с возвратом И без закупа попал бы в «не учтено» и продавец
    // пошёл бы дозаполнять прайс вместо того, чтобы просто увидеть возврат.
    if (isReturned(order, options?.returned)) {
      returnedOrders += 1;
      returnedRevenue += orderRevenue;
      continue;
    }

    const resolved = orderPurchase(order, costs);

    if (resolved === null) {
      excludedOrders += 1;
      excludedRevenue += orderRevenue;
      for (const item of order?.items ?? []) {
        unknown.add(item?.offerId ?? '(без артикула)');
      }
      continue;
    }

    revenue += orderRevenue;
    purchase += resolved;
    counted += 1;
  }

  const commission = (revenue * commissionPercent) / 100;
  const tax = (revenue * taxPercent) / 100;

  return {
    revenue,
    commission,
    tax,
    purchase,
    net: revenue - commission - tax - purchase,
    orders: counted,
    excludedOrders,
    excludedRevenue,
    // Только те артикулы, закупа по которым действительно нет: в исключённом
    // заказе часть позиций могла найтись.
    unknownSkus: [...unknown].filter((sku) => !costs.has(sku)),
    returnedOrders,
    returnedRevenue,
    // Ставки возвращаются целиком, включая скидки: отчёт печатает их рядом с
    // суммами, чтобы число можно было проверить.
    rates: normalized,
  };
}

// --- ввод ставок -------------------------------------------------------------

/** Настройка, которую можно изменить сообщением. */
export type TRateField =
  | 'commissionPercent'
  | 'taxPercent'
  | 'vostokDiscountPercent'
  | 'discountPercent';

export interface IRateInput {
  field: TRateField;
  value: number;
}

export interface IRateValidation {
  ok: boolean;
  error?: string;
}

/**
 * Подписи, по которым узнаётся ставка.
 *
 * Русские слова первыми: продавец пишет «комиссия: 25», а не `commission`.
 * Английские приняты тоже — так подписан токен, и требовать от человека угадать,
 * какое поле подписывается по-русски, а какое по-английски, было бы издевательством.
 */
const RATE_LABELS: Readonly<Record<string, TRateField>> = {
  комиссия: 'commissionPercent',
  commission: 'commissionPercent',
  налог: 'taxPercent',
  tax: 'taxPercent',
  // Двухсловные подписи разбираются тем же правилом. «скидка восток» обязана
  // проверяться РАНЬШЕ «скидки» — иначе более общая подпись съест частную.
  'скидка восток': 'vostokDiscountPercent',
  'скидка на восток': 'vostokDiscountPercent',
  скидка: 'discountPercent',
  discount: 'discountPercent',
};

/** Человеческое название ставки — для подтверждения и ошибки. */
export function rateTitle(field: TRateField): string {
  switch (field) {
    case 'commissionPercent':
      return 'Комиссия Яндекс.Маркета';
    case 'taxPercent':
      return 'Налог с продаж';
    case 'vostokDiscountPercent':
      return 'Скидка от прайса на «Восток»';
    default:
      return 'Скидка от прайса';
  }
}

/**
 * Разбор сообщения вида «комиссия: 23».
 *
 * ОТДЕЛЬНЫЙ парсер, а не ветка в `parseLabelledValue`: тот возвращает
 * `TDraftField`, и расширение того объединения потянуло бы за собой
 * `DRAFT_FIELD_SET`, `ONBOARDING_STEPS` и все `switch (step)` в onboarding.ts —
 * включая `validateStep`, где числовая проверка требует 5–15 цифр и отвергла бы
 * «23».
 *
 * Проценты принимаются с десятыми и с запятой: продавец пишет и «23.5», и
 * «23,5», а знак процента дописывает по привычке.
 *
 * Подпись бывает из двух-трёх слов («скидка на восток»), поэтому пробелы внутри
 * разрешены и нормализуются — «скидка   восток» и «Скидка На Восток» это одно и
 * то же.
 */
export function parseRateInput(text: string): IRateInput | null {
  const match = String(text ?? '')
    .trim()
    .match(/^([А-Яа-яЁёA-Za-z]+(?:\s+[А-Яа-яЁёA-Za-z]+){0,2})\s*:\s*([\d.,]+)\s*%?$/);
  if (!match) return null;

  const label = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
  const field = RATE_LABELS[label];
  if (!field) return null;

  const value = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(value)) return null;

  return { field, value };
}

/** Проверка ставки. Ошибка возвращается, чтобы обработчик переспросил. */
export function validateRate(field: TRateField, value: number): IRateValidation {
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${rateTitle(field)} — это число, например 23.` };
  }

  if (value < MIN_RATE_PERCENT || value > MAX_RATE_PERCENT) {
    return {
      ok: false,
      error:
        `${rateTitle(field)} указывается в процентах — от ${MIN_RATE_PERCENT} ` +
        `до ${MAX_RATE_PERCENT}. Пришло: ${value}.`,
    };
  }

  return { ok: true };
}
