import type { IProductPriceRow, IProductPurchase } from './product.domain';
import type {
  IDiscountConfig,
  IProfitRates,
  IPurchaseRow,
  TCostOf,
} from '../yandex/reports/profit';

import { moscowDay } from '../yandex/reports/moscow-day';
import { orderDayIso } from '../yandex/reports/order-day';
import { DEFAULT_RATES, discountsOf } from '../yandex/reports/profit';

import { PRODUCT_BASE_CURRENCY, productCost } from './product.domain';

/**
 * История себестоимости — чистые правила, без Nest и Mongo (TASK-116).
 *
 * Зачем. Закуп в `PurchasePrice` один на артикул — текущий. Новый прайс с другой
 * ценой молча пересчитывал прошлые месяцы «Прибыли». История хранит, С КАКОГО
 * ДНЯ действует цена, и отчёт берёт себестоимость на дату продажи.
 *
 * ДЕНЬ — строка `ГГГГ-ММ-ДД` по Москве, а не момент. Цена действует с начала
 * московского дня загрузки: продавец живёт календарём, и «цена с 16-го» —
 * это его язык. Строки сравниваются лексикографически, без арифметики
 * миллисекунд (довод moscow-day.ts: контейнер живёт в UTC).
 *
 * СТАРТОВАЯ ЗАПИСЬ — `validFrom: null`, «с начала времён» (решение владельца
 * `cost_history_baseline_forever`): цена, известная до появления истории,
 * действует для всех прошлых продаж, поэтому выкатка не сдвинула «Прибыль» ни
 * на рубль. Её НЕ заводят миграцией: пока у товара нет ни одной записи, цена с
 * выкатки не менялась, и текущий закуп и есть стартовая запись (`current` в
 * `costAt`). Загрузка, меняющая цену, сначала пишет стартовую со СТАРОЙ ценой.
 */

/** Откуда запись: стартовая, загрузка прайса, ручная правка (ТЗ п.6). */
export type TCostSource = 'baseline' | 'price-list' | 'manual';

/** Запись истории в объёме, нужном правилам. */
export interface ICostRecord extends IProductPurchase {
  /** Московский день `ГГГГ-ММ-ДД`, с которого действует; `null` — с начала времён. */
  validFrom: string | null;
  source?: TCostSource;
  /** Кто правил руками — telegramUserId продавца; у прайса и стартовой нет. */
  author?: string;
}

/** История товара плюс текущий закуп — неявная стартовая запись. */
export interface ICostHistorySource {
  history?: readonly ICostRecord[];
  /** Текущий закуп. Действует, только пока у товара нет истории вовсе. */
  current?: IProductPurchase | null;
}

/** Запись, которую загрузка прайса добавляет (или переписывает за тот же день). */
export interface ICostHistoryWrite {
  productId: string;
  validFrom: string | null;
  purchase: IProductPurchase;
  source: TCostSource;
}

/**
 * Московский день `ГГГГ-ММ-ДД` из момента или из даты заказа в любой из форм,
 * которые присылает Маркет (`orderDayIso`). Мусор и пустота — `null`.
 */
export function costDayOf(date: Date | string | null | undefined): string | null {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    const { year, month, day } = moscowDay(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return orderDayIso(date);
}

/**
 * Закуп, действующий в московский день `date`, или `null` — неизвестен.
 *
 * Последняя запись с `validFrom ≤ день`; стартовая подходит любой дате. Дата
 * неизвестна — подходит только стартовая: угадывать день значило бы выбрать
 * цену наугад. Записи до даты нет — `null`, а НЕ текущая цена (довод
 * `orderPurchase`: неизвестное не ноль и не «что-нибудь похожее»).
 *
 * Истории нет вовсе — текущий закуп (`current`): цена не менялась с выкатки.
 */
export function costAt(
  source: ICostHistorySource,
  date: Date | string | null | undefined,
): IProductPurchase | null {
  const history = source?.history ?? [];
  if (!history.length) return source?.current ?? null;

  const best = recordAt(history, date);
  return best ? purchaseOf(best) : null;
}

/** Запись истории, действующая в день `date`, — `costAt` без неявной стартовой. */
export function recordAt(
  history: readonly ICostRecord[] | undefined,
  date: Date | string | null | undefined,
): ICostRecord | null {
  const day = costDayOf(date);
  let best: ICostRecord | null = null;

  for (const record of history ?? []) {
    const from = record?.validFrom ?? null;
    if (from !== null && (day === null || from > day)) continue;
    if (best === null || (best.validFrom ?? '') < (from ?? '')) best = record;
  }

  return best;
}

/** Товар для себестоимости на дату: бренд, история и текущий закуп. */
export interface ICostOnSource extends ICostHistorySource {
  name?: string;
  category?: string;
}

/**
 * Себестоимость единицы на московский день `date`, в рублях, или `null` —
 * неизвестна. ЕДИНСТВЕННАЯ точка, где история встречается со скидкой бренда:
 * через неё считают «Прибыль» (`datedCosts`), колонка «Закуп» «Прайса»
 * (`costsOn`) и раздел «Товары». Две функции разошлись бы на первой ручной
 * правке в валюте (TASK-118).
 */
export function costOn(
  source: ICostOnSource,
  config: IDiscountConfig,
  date: Date | string | null | undefined,
): number | null {
  const purchase = costAt(source, date);
  if (!purchase) return null;
  return productCost({ name: source?.name, category: source?.category, purchase }, config);
}

/**
 * Себестоимость строк прайса на день `date` — колонка «Закуп» «Прайса».
 * Текущий закуп — цена строки (неявная стартовая); история — по артикулу ЯМ.
 */
export function costsOn(
  rows: ReadonlyMap<string, IPurchaseRow>,
  histories: ReadonlyMap<string, readonly ICostRecord[]>,
  rates: IProfitRates,
  date: Date | string,
): Map<string, number | null> {
  const config = discountsOf(rates ?? {});
  const result = new Map<string, number | null>();
  for (const [sku, row] of rows) {
    result.set(
      sku,
      costOn(
        {
          name: row?.name,
          category: row?.category,
          history: histories.get(sku),
          current: { price: row.price },
        },
        config,
        date,
      ),
    );
  }
  return result;
}

/** Совпадает ли закуп: цена, валюта (пустая — рубли), курс и доп. расходы. */
export function samePurchase(a: IProductPurchase, b: IProductPurchase): boolean {
  return (
    Number(a?.price) === Number(b?.price) &&
    currencyOf(a) === currencyOf(b) &&
    (Number(a?.rate) || 0) === (Number(b?.rate) || 0) &&
    (Number(a?.extraCosts) || 0) === (Number(b?.extraCosts) || 0)
  );
}

/** Что нужно знать загрузке о товарах прайса, чтобы решить, что записать. */
export interface IHistoryWriteContext {
  /** Артикул → id товара. Нет товара — истории писать некуда. */
  productIds: ReadonlyMap<string, string>;
  /** Id товара → его история. */
  histories: ReadonlyMap<string, readonly ICostRecord[]>;
  /** Закуп ДО этой загрузки — материал стартовой записи. */
  previous: ReadonlyMap<string, { price: number }>;
}

/**
 * Записи истории по загрузке прайса. Пишет ТОЛЬКО изменения: тот же прайс
 * второй раз даёт ноль записей.
 *
 * - истории нет, прежний закуп был и совпадает — ничего: неявная стартовая
 *   запись по-прежнему верна;
 * - истории нет, прежний закуп был и другой — стартовая со СТАРОЙ ценой плюс
 *   запись дня с новой: иначе новая цена стала бы стартовой и переписала прошлое;
 * - истории нет и закупа не было — стартовая с новой ценой. Первая известная
 *   цена действует назад: отчёт сам просит «пришлите прайс с этими позициями»,
 *   и прайс обязан чинить прошлые заказы, как чинил до истории;
 * - история есть — запись дня, если действующая сегодня цена другая. Запись
 *   того же дня переписывается (ключ — товар и день), а не копится.
 *
 * Ручная правка (TASK-118, решение `product_manual_vs_price_list`): прайс меняет
 * ЦЕНУ, доп. расходы действующей записи переносятся — это свойство товара, а не
 * цены поставщика. Валюта и курс сбрасываются: в прайсе рубли. Файл с той же
 * ценой, что прошлый, действующую ручную запись не трогает — ежедневная загрузка
 * остатков иначе стирала бы ручной закуп в валюте каждый день.
 */
export function historyWrites(
  rows: readonly IProductPriceRow[],
  context: IHistoryWriteContext,
  today: string,
): ICostHistoryWrite[] {
  const writes: ICostHistoryWrite[] = [];

  for (const row of rows ?? []) {
    const productId = context.productIds.get(row.sku);
    if (!productId) continue;

    const next: IProductPurchase = { price: row.price, currency: PRODUCT_BASE_CURRENCY };
    const history = context.histories.get(productId) ?? [];

    if (!history.length) {
      const previous = context.previous.get(row.sku);
      if (!previous) {
        writes.push({ productId, validFrom: null, purchase: next, source: 'baseline' });
        continue;
      }

      const old: IProductPurchase = { price: previous.price, currency: PRODUCT_BASE_CURRENCY };
      if (samePurchase(old, next)) continue;

      writes.push({ productId, validFrom: null, purchase: old, source: 'baseline' });
      writes.push({ productId, validFrom: today, purchase: next, source: 'price-list' });
      continue;
    }

    const record = recordAt(history, today);
    if (record?.source === 'manual' && samePrice(context.previous.get(row.sku), row.price))
      continue;

    const effective = record ? purchaseOf(record) : null;
    if (effective?.extraCosts) next.extraCosts = effective.extraCosts;
    if (effective && samePurchase(effective, next)) continue;
    writes.push({ productId, validFrom: today, purchase: next, source: 'price-list' });
  }

  return writes;
}

/**
 * Закуп позиции на дату заказа — резолвер для `profitOf`/`orderPurchase`.
 *
 * Дата продажи — `creationDate` заказа в ОБОИХ наборах «Прибыли»: себестоимость
 * относится к моменту продажи, а не выкупа. Себестоимость — `productCost`, та
 * же скидка бренда, что у товаров; бренд — по названию и категории из прайса.
 * Истории нет — текущая строка прайса (неявная стартовая), то есть прежнее
 * `applyDiscounts` до рубля.
 */
export function datedCosts(
  rows: ReadonlyMap<string, IPurchaseRow>,
  histories: ReadonlyMap<string, readonly ICostRecord[]>,
  rates: IProfitRates = DEFAULT_RATES,
): TCostOf {
  const config = discountsOf(rates ?? {});

  return (sku, order) => {
    const row = rows.get(sku);
    const source = {
      name: row?.name,
      category: row?.category,
      history: histories.get(sku),
      current: row ? { price: row.price } : null,
    };
    return costOn(source, config, order?.creationDate) ?? undefined;
  };
}

/**
 * Записи истории по ручной правке закупа. Пишет только изменение:
 *
 * - истории нет и закуп был — стартовая со СТАРЫМ закупом плюс запись дня:
 *   иначе ручная цена стала бы стартовой и переписала прошлые месяцы;
 * - истории нет и закупа не было — ручная цена становится стартовой: как
 *   первая цена из прайса, она чинит прошлые заказы без себестоимости;
 * - история есть — запись дня, если действующая сегодня другая. Запись того же
 *   дня (в том числе прайса) переписывается: ручная правка новее.
 */
export function manualWrites(
  source: ICostHistorySource,
  next: IProductPurchase,
  today: string,
): Omit<ICostHistoryWrite, 'productId'>[] {
  const history = source?.history ?? [];

  if (!history.length) {
    const current = source?.current;
    if (!current) return [{ validFrom: null, purchase: next, source: 'baseline' }];
    if (samePurchase(current, next)) return [];
    return [
      { validFrom: null, purchase: current, source: 'baseline' },
      { validFrom: today, purchase: next, source: 'manual' },
    ];
  }

  const effective = costAt({ history }, today);
  if (effective && samePurchase(effective, next)) return [];
  return [{ validFrom: today, purchase: next, source: 'manual' }];
}

function samePrice(previous: { price: number } | undefined, price: number): boolean {
  return previous !== undefined && Number(previous.price) === Number(price);
}

function purchaseOf(record: ICostRecord): IProductPurchase {
  const purchase: IProductPurchase = { price: record.price };
  if (record.currency) purchase.currency = record.currency;
  if (record.rate !== undefined && record.rate !== null) purchase.rate = record.rate;
  if (record.extraCosts !== undefined && record.extraCosts !== null) {
    purchase.extraCosts = record.extraCosts;
  }
  return purchase;
}

function currencyOf(purchase: IProductPurchase): string {
  const code = purchase?.currency?.trim().toUpperCase();
  return !code || code === 'RUB' ? PRODUCT_BASE_CURRENCY : code;
}
