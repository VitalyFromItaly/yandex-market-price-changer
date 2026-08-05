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
 * СУММА ПРОДАЖИ = `itemsTotal` + СУБСИДИИ МАРКЕТА, только товары. Доставку
 * платит покупатель, она не выручка продавца.
 *
 * Субсидии здесь — не придирка, а больше 400 тысяч рублей за июль. `itemsTotal`
 * по документации — «Платёж покупателя», а `item.price` — «цена без учёта
 * вознаграждения партнёру за скидки по промокодам, купонам и акциям (параметр
 * `subsidies`)». Скидку Маркета платит Маркет, и продавцу он её КОМПЕНСИРУЕТ,
 * поэтому выручка продавца больше платежа покупателя. Проверено на боевом
 * магазине за июль (394 выкупленных заказа, закуп 1 649 259 ₽):
 *
 *   только itemsTotal   выручка 2 456 985  чистая  70 630  наценка 49 %, к закупу  4 %
 *   + субсидии          выручка 2 877 765  чистая 365 176  наценка 74 %, к закупу 22 %
 *
 * Вторая строка — ровно то, что заказчик и описывал («наценка около 70 %, маржа
 * около 20 %»); первая выглядела как «магазин работает в ноль». Заодно
 * выяснилось, что прежний комментарий здесь утверждал обратное — будто
 * `itemsTotal` включает компенсацию субсидий, а `Σ(item.price × count)` нет. На
 * боевых данных эти две суммы совпали ДО РУБЛЯ (2 456 985), и субсидий не
 * содержит ни одна.
 */

import { brandOf, isBrandKey, type TBrandKey } from './brands';
import { orderTotals, subsidiesTotal, type IOrderMoney } from './money';
import { promoConfigsOf, promoPercentAt } from './promo';

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
 * согласованная скидка. Скидка своя у каждого бренда (реестр — brands.ts),
 * дефолт для брендов без явной настройки — `DEFAULT_DISCOUNT_PERCENT`.
 * Проверено на боевых данных: без скидок месяц выходил с убытком, потому что
 * «закуп» составлял 75,8 % выручки.
 *
 * Скидка применяется при РАСЧЁТЕ, а не при сохранении цены: в базе лежит цена
 * ровно как в прайсе. Иначе смена процента требовала бы перезагрузки файла, а
 * заказчик просил их регулировать.
 *
 * `DEFAULT_VOSTOK_DISCOUNT_PERCENT` — дефолт и ЛЕГАСИ-ФОЛБЭК бренда «Восток»:
 * скидки по брендам живут в карте `brandDiscounts`, но продавцы, настроившие
 * «Восток» до её появления, хранят значение в старом поле
 * `vostokDiscountPercent` — его читает discountsOf, когда в карте записи нет.
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
  /** Легаси-скидка по «Востоку», % — фолбэк, когда в brandDiscounts нет записи. */
  vostokDiscountPercent: number;
  /** Скидка от прайса для брендов без своей настройки, %. */
  discountPercent: number;
  /** Явные скидки по брендам: ключ — TBrandKey из brands.ts. */
  brandDiscounts?: Readonly<Record<string, number>>;
  /**
   * Комиссия за продвижение по брендам: ключ — TBrandKey, значение —
   * TPromoConfig из promo.ts. Насквозь, как brandDiscounts: нормализация —
   * дело promoConfigsOf, один раз в profitOf.
   */
  promoCommissions?: Readonly<Record<string, unknown>>;
}

export const DEFAULT_RATES: IProfitRates = {
  commissionPercent: DEFAULT_COMMISSION_PERCENT,
  taxPercent: DEFAULT_TAX_PERCENT,
  vostokDiscountPercent: DEFAULT_VOSTOK_DISCOUNT_PERCENT,
  discountPercent: DEFAULT_DISCOUNT_PERCENT,
};

/** Строка закупа, как она лежит в базе: цена ПРАЙСА плюс её происхождение. */
export interface IPurchaseRow {
  price: number;
  name?: string;
  category?: string;
}

/**
 * Скидки, приведённые к пригодным для счёта: дефолт плюс явные по брендам.
 *
 * `brandPercents` — Partial: запись есть только у брендов, по которым скидка
 * известна (задана продавцом или пришла из легаси-поля «Востока»). Отсутствие
 * записи означает «по дефолту», и это решает brandDiscountOf.
 */
export interface IDiscountConfig {
  defaultPercent: number;
  brandPercents: Readonly<Partial<Record<TBrandKey, number>>>;
}

/**
 * Конфиг скидок из документа магазина. ЕДИНСТВЕННОЕ место, где решается
 * цепочка фолбэков:
 *
 *   brandDiscounts[бренд] → (для «Востока») vostokDiscountPercent → discountPercent
 *
 * Легаси-поле `vostokDiscountPercent` запекается в карту, когда явной записи
 * нет: продавцы настроили его до появления скидок по брендам, и «влить в новую
 * систему» не должно означать «потерять настройку». Миграции данных поэтому не
 * нужно вовсе.
 *
 * Мусорная запись карты (не число, вне границ) выкидывается — падать или
 * ронять весь конфиг из-за одного руками правленного значения нельзя, ровно как
 * в normalizeRate. Неизвестный ключ игнорируется по той же причине.
 */
export function discountsOf(store: {
  discountPercent?: number;
  vostokDiscountPercent?: number;
  brandDiscounts?: Readonly<Record<string, number>>;
}): IDiscountConfig {
  const defaultPercent = normalizeRate(store?.discountPercent, DEFAULT_DISCOUNT_PERCENT);

  const brandPercents: Partial<Record<TBrandKey, number>> = {};
  for (const [key, raw] of Object.entries(store?.brandDiscounts ?? {})) {
    if (!isBrandKey(key)) continue;

    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (value < MIN_RATE_PERCENT || value > MAX_RATE_PERCENT) continue;

    brandPercents[key] = value;
  }

  if (brandPercents.vostok === undefined) {
    brandPercents.vostok = normalizeRate(
      store?.vostokDiscountPercent,
      DEFAULT_VOSTOK_DISCOUNT_PERCENT,
    );
  }

  return { defaultPercent, brandPercents };
}

/**
 * Действующая скидка бренда. `0` в карте — валидная скидка, а не «нет записи»:
 * продавец мог договориться без скидки, и это отличается от «по дефолту».
 */
export function brandDiscountOf(config: IDiscountConfig, brand: TBrandKey | null): number {
  if (!brand) return config.defaultPercent;
  return config.brandPercents[brand] ?? config.defaultPercent;
}

/** Закуп одной позиции по готовому конфигу — общий шаг двух функций ниже. */
function costAt(row: IPurchaseRow, config: IDiscountConfig): number {
  const percent = brandDiscountOf(config, brandOf(row));
  return amount(row?.price) * (1 - percent / 100);
}

/** Закуп одной позиции: цена прайса минус скидка её бренда. */
export function purchaseCost(row: IPurchaseRow, rates: IProfitRates = DEFAULT_RATES): number {
  return costAt(row, discountsOf(rates ?? {}));
}

/**
 * Цены прайса → закуп по каждому артикулу.
 *
 * Отдельным шагом, а не внутри profitOf: скидка — это свойство строки прайса, а
 * не заказа, и считать её на каждое вхождение товара в заказ незачем. Конфиг
 * скидок собирается ОДИН раз на всю карту, а не на строку.
 */
export function applyDiscounts(
  rows: Map<string, IPurchaseRow>,
  rates: IProfitRates = DEFAULT_RATES,
): Map<string, number> {
  const config = discountsOf(rates ?? {});
  const costs = new Map<string, number>();

  for (const [sku, row] of rows) {
    costs.set(sku, costAt(row, config));
  }

  return costs;
}

/** Позиция заказа в объёме, нужном для закупа и продвижения. */
export interface IProfitOrderItem {
  /** Артикул каталога. Тот же, по которому лежит закупочная цена. */
  offerId?: string;
  count?: number;
  /**
   * Цена продажи за ЕДИНИЦУ, без субсидий Маркета. По ней считается комиссия
   * за продвижение: и порог ступени, и сам процент — от ценника товара.
   */
  price?: number;
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
  /**
   * Строки закупа по артикулам — для определения БРЕНДА позиции при расчёте
   * продвижения (brandOf смотрит на название и категорию). Не передали — промо
   * считается нулевым: карта costs для этого не годится, в ней уже числа.
   */
  rows?: ReadonlyMap<string, IPurchaseRow>;
  /**
   * Услуги Маркета ПО ЗАКАЗАМ вместо плоской комиссии — заказ → сумма услуг
   * (`id` заказа, как у `returned`). Так считает экран «Калькулятор»: у него
   * та же формула чистой, отличается только чем заменена комиссия.
   *
   * Формула живёт здесь, а не копией в калькуляторе, намеренно: два места,
   * считающих чистую, разъедутся — ровно так уже расходились экраны справки и
   * настроек.
   *
   * Заказ, которого в карте НЕТ, исключается так же, как заказ без закупочной
   * цены: посчитать его нечем, а взять услуги нулём значило бы завысить
   * прибыль молча. Не передали карту вовсе — работает обычный режим плоской
   * ставки.
   */
  services?: ReadonlyMap<number | string, number>;
}

/** Услуги по заказу, если они известны. Сравнение id и числом, и строкой. */
function servicesOf(
  order: IProfitOrder,
  services?: IProfitOptions['services'],
): number | null | undefined {
  if (!services) return undefined;
  if (order?.id == null) return null;
  return services.get(order.id) ?? services.get(String(order.id)) ?? null;
}

/** Есть ли по заказу возврат. Сравнение и числом, и строкой: id приходит по-разному. */
function isReturned(order: IProfitOrder, returned?: TReturnedOrders): boolean {
  if (!returned?.size || order?.id == null) return false;
  return returned.has(order.id) || returned.has(String(order.id));
}

export interface IProfitTotals {
  /** Сумма продажи — только товары, вместе с субсидиями Маркета. */
  revenue: number;
  /**
   * Сколько из выручки — субсидии Маркета.
   *
   * Печатается отдельной строкой: остальные отчёты показывают «Товары» как
   * платёж покупателя, и без этого числа продажи в прибыли выглядели бы
   * расхождением с ними.
   */
  subsidies: number;
  commission: number;
  tax: number;
  /**
   * Комиссия за продвижение — по позициям выкупленных заказов, ставка бренда
   * от цены товара (promo.ts). Ноль, когда продвижение не настроено.
   */
  promo: number;
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
  brandDiscounts?: Readonly<Record<string, number>>;
  promoCommissions?: Readonly<Record<string, unknown>>;
}): IProfitRates {
  return {
    commissionPercent: normalizeRate(store?.commissionPercent, DEFAULT_COMMISSION_PERCENT),
    taxPercent: normalizeRate(store?.taxPercent, DEFAULT_TAX_PERCENT),
    vostokDiscountPercent: normalizeRate(
      store?.vostokDiscountPercent,
      DEFAULT_VOSTOK_DISCOUNT_PERCENT,
    ),
    discountPercent: normalizeRate(store?.discountPercent, DEFAULT_DISCOUNT_PERCENT),
    // Насквозь, без пер-записной нормализации: она — дело discountsOf, второй
    // раз то же правило здесь означало бы два места, где оно может разойтись.
    brandDiscounts: store?.brandDiscounts,
    // Тот же довод: нормализация — дело promoConfigsOf.
    promoCommissions: store?.promoCommissions,
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

  // Продвижение начисляется по позициям, ставка бренда — от цены товара.
  // Конфиг приводится ОДИН раз на весь набор, как в applyDiscounts; без строк
  // закупа бренд позиции не определить, и промо честно остаётся нулём.
  const promoConfigs = promoConfigsOf(normalized.promoCommissions);
  const promoRows = Object.keys(promoConfigs).length > 0 ? options?.rows : undefined;

  let revenue = 0;
  let subsidies = 0;
  let promo = 0;
  let purchase = 0;
  let counted = 0;
  // Комиссия по услугам копится по заказам; при плоской ставке она считается
  // от итоговой выручки ниже.
  let services = 0;
  let excludedOrders = 0;
  let excludedRevenue = 0;
  let returnedOrders = 0;
  let returnedRevenue = 0;
  const unknown = new Set<string>();

  for (const order of orders ?? []) {
    // Выручка = платёж покупателя ПЛЮС субсидия Маркета: скидку по акции даёт
    // Маркет, а продавцу компенсирует. Без второго слагаемого месяц выходил с
    // маржой 4 % вместо 22 % (см. шапку модуля).
    const orderSubsidies = subsidiesTotal(order);
    const orderRevenue = orderTotals(order).items + orderSubsidies;

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
    const orderServices = servicesOf(order, options?.services);

    // Заказ считается, только когда известно И то и другое: наполовину
    // посчитанный заказ дал бы правдоподобное неверное число.
    if (resolved === null || orderServices === null) {
      excludedOrders += 1;
      excludedRevenue += orderRevenue;
      for (const item of order?.items ?? []) {
        unknown.add(item?.offerId ?? '(без артикула)');
      }
      continue;
    }

    revenue += orderRevenue;
    subsidies += orderSubsidies;
    purchase += resolved;
    services += orderServices ?? 0;
    counted += 1;

    // Только по УЧТЁННЫМ заказам — возвраты и исключённые ушли по continue
    // выше, и продвижение по ним начислять не за что. Позиция без цены даёт
    // ноль: комиссия считается от ценника, которого нет.
    if (promoRows) {
      for (const item of order?.items ?? []) {
        const row = item?.offerId ? promoRows.get(item.offerId) : undefined;
        const brand = row ? brandOf(row) : null;
        const config = brand ? promoConfigs[brand] : undefined;
        if (!config) continue;

        const price = amount(item?.price);
        if (!price) continue;

        const count = amount(item?.count) || 1;
        promo += (price * count * promoPercentAt(config, price)) / 100;
      }
    }
  }

  // Комиссия — либо сумма услуг по калькулятору (накоплена по заказам), либо
  // плоская ставка от выручки. Строка одна: чистая считается ниже одинаково,
  // чем бы комиссия ни была.
  const commission = options?.services ? services : (revenue * commissionPercent) / 100;
  const tax = (revenue * taxPercent) / 100;

  return {
    revenue,
    subsidies,
    commission,
    tax,
    promo,
    purchase,
    net: revenue - commission - tax - promo - purchase,
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

/**
 * Настройка, которую можно изменить кнопкой или сообщением.
 *
 * Скидок по брендам здесь НЕТ и быть не должно: их множество задаётся реестром
 * в brands.ts, а не фиксированным объединением, и у них свой путь записи
 * (`updateBrandDiscount`), свой кодек кнопок (`bdisc:`) и свой парсер
 * («скидка casio: 5»). Прежний член `vostokDiscountPercent` уехал туда же —
 * «Восток» стал обычным брендом.
 */
export type TRateField = 'commissionPercent' | 'taxPercent' | 'discountPercent';

/**
 * Все три ставки — списком.
 *
 * Собран из `Record<TRateField, true>`, а НЕ написан массивом-литералом, и это
 * принципиально: `Record` обязывает компилятор потребовать каждый член
 * объединения, а `TRateField[]` полноты не требует. Дефект на память —
 * `DRAFT_FIELD_SET` в user-access.service.ts: тип расширили, массив забыли,
 * компилятор промолчал, и пользователь получал ошибку на верном вводе.
 *
 * Порядок задаёт порядок кнопок на экране настроек: сначала то, что вычитается
 * из продажи, потом скидка от прайса — так же, как идёт текст экрана.
 */
const RATE_FIELD_SET: Record<TRateField, true> = {
  commissionPercent: true,
  taxPercent: true,
  discountPercent: true,
};

export const RATE_FIELDS = Object.keys(RATE_FIELD_SET) as TRateField[];

/** Является ли строка из базы или из callback_data известной ставкой. */
export function isRateField(value: unknown): value is TRateField {
  return typeof value === 'string' && RATE_FIELDS.includes(value as TRateField);
}

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
  // «скидка восток» здесь больше нет: подписи брендов живут в реестре brands.ts
  // и разбираются parseBrandDiscountInput — РАНЬШЕ этого парсера, тем же
  // приёмом «частное раньше общего», каким раньше упорядочивались эти ключи.
  скидка: 'discountPercent',
  discount: 'discountPercent',
};

/**
 * Подпись, которую надо предложить продавцу для текстового ввода.
 *
 * ВЫВОДИТСЯ из RATE_LABELS, а не пишется рядом ещё одним switch: подсказка
 * обязана быть подписью, которую парсер действительно принимает. Пока примеры
 * стояли литералами («комиссия: 23» в двух файлах), они были ещё и с чужим
 * значением — экран показывал «Комиссия 25 %» и тут же предлагал «комиссия: 23».
 *
 * Берётся ПЕРВОЕ совпадение, поэтому русская подпись выигрывает у английской:
 * порядок ключей в RATE_LABELS и есть порядок предпочтения.
 */
export function rateInputLabel(field: TRateField): string {
  return Object.keys(RATE_LABELS).find((label) => RATE_LABELS[label] === field) ?? field;
}

/**
 * Короткая подпись для кнопки. Рядом с ней встанет значение («📉 Комиссия 23%»).
 *
 * Именно короткая: в ряду из двух кнопок Telegram обрезает подписи, и полное
 * «Комиссия Яндекс.Маркета» превратилось бы в неразличимый огрызок — тем же
 * способом уже ломались кнопки рассылки (см. schedule.handler.ts).
 */
export function rateShortLabel(field: TRateField): string {
  switch (field) {
    case 'commissionPercent':
      return '📉 Комиссия';
    case 'taxPercent':
      return '🧾 Налог';
    default:
      return '📦 Скидка';
  }
}

/** Человеческое название ставки — для подтверждения и ошибки. */
export function rateTitle(field: TRateField): string {
  switch (field) {
    case 'commissionPercent':
      return 'Комиссия Яндекс.Маркета';
    case 'taxPercent':
      return 'Налог с продаж';
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
 * Многословные подписи разрешены и нормализуются — «скидка» и «Скидка» это одно
 * и то же; брендовые («скидка восток: 4») сюда не доходят, их РАНЬШЕ разбирает
 * parseBrandDiscountInput из brands.ts.
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

/**
 * Разбор ГОЛОГО числа: «23», «23,5», «7 %».
 *
 * Нужен там, где подписи уже нет: продавец нажал кнопку «📉 Комиссия», бот
 * спросил новое значение — переспрашивать его ещё и подписью значило бы не
 * поверить собственному вопросу. `parseRateInput` для этого не годится и
 * годиться не должен: он обязан возвращать `null` на «23», иначе любое число в
 * чате уезжало бы в настройки.
 */
export function parseRateValue(text: string): number | null {
  const match = String(text ?? '')
    .trim()
    .match(/^([\d]+(?:[.,]\d+)?)\s*%?$/);
  if (!match) return null;

  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * callback_data кнопок правки ставок. Формирование и разбор рядом — тем же
 * приёмом, что у отчётов (`reportCallback`) и рассылки (`scheduleCallback`),
 * чтобы формат не разъехался между кнопкой и обработчиком.
 *
 * Самое длинное значение — `rate:commissionPercent`, 22 байта при лимите
 * Telegram в 64.
 */
export const RATE_CB_PREFIX = 'rate:';

/** Отмена вопроса «пришлите новое значение». */
export const RATE_CB_CANCEL = `${RATE_CB_PREFIX}cancel`;

export const RATE_CB_PATTERN = new RegExp(
  `^${RATE_CB_PREFIX}(${[...RATE_FIELDS, 'cancel'].join('|')})$`,
);

export function rateCallback(field: TRateField): string {
  return `${RATE_CB_PREFIX}${field}`;
}

/** Что нажали: конкретную ставку, отмену или ничего из нашего. */
export function parseRateCallback(data: string): TRateField | 'cancel' | null {
  const tail = RATE_CB_PATTERN.exec(String(data ?? ''))?.[1];
  if (!tail) return null;
  return tail === 'cancel' ? 'cancel' : (tail as TRateField);
}

/**
 * Проверка процента с подписью в тексте ошибки. Общая для ставок и скидок по
 * брендам: границы одни, и два экземпляра правила разошлись бы.
 */
export function validatePercent(title: string, value: number): IRateValidation {
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${title} — это число, например 23.` };
  }

  if (value < MIN_RATE_PERCENT || value > MAX_RATE_PERCENT) {
    return {
      ok: false,
      error:
        `${title} указывается в процентах — от ${MIN_RATE_PERCENT} ` +
        `до ${MAX_RATE_PERCENT}. Пришло: ${value}.`,
    };
  }

  return { ok: true };
}

/** Проверка ставки. Ошибка возвращается, чтобы обработчик переспросил. */
export function validateRate(field: TRateField, value: number): IRateValidation {
  return validatePercent(rateTitle(field), value);
}
