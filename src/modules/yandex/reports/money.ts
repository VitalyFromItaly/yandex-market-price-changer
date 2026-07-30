/**
 * Денежная арифметика отчётов.
 *
 * Главный риск здесь — не падение, а правдоподобно неверная сумма. У заказа в
 * Partner API ВОСЕМЬ денежных полей, и половина объявлена устаревшей:
 * `total`, `subsidyTotal`, `totalWithSubsidy`, `buyerItemsTotal`, `buyerTotal`,
 * `priceBeforeDiscount`. Они до сих пор приходят в ответе и выглядят ровно так
 * же, как актуальные, — взять `total` вместо `itemsTotal` очень легко, и отчёт
 * молча разойдётся с личным кабинетом.
 *
 * Актуальные: `itemsTotal` (товары) и `deliveryTotal` (доставка).
 * Отчёты показывают ОБЕ величины: сумму товаров и сумму с доставкой, —
 * потому что продавцы сверяются то с одной, то с другой.
 */

import { SUBSIDY_TYPE } from './report-status-map';

/** Поля, которые брать НЕЛЬЗЯ. Список из документации Partner API. */
export const DEPRECATED_MONEY_FIELDS = [
  'total',
  'subsidyTotal',
  'totalWithSubsidy',
  'buyerItemsTotal',
  'buyerTotal',
  'priceBeforeDiscount',
  'refundAmount',
  'partnerCompensation',
] as const;

export interface IOrderSubsidy {
  type?: string;
  amount?: number;
}

/** Заказ в объёме, нужном для денег. Всё опционально: ответ бывает неполным. */
export interface IOrderMoney {
  itemsTotal?: number;
  deliveryTotal?: number;
  /** Субсидии ЗАКАЗА — итог по типам, а не на единицу товара (см. subsidiesTotal). */
  subsidies?: readonly IOrderSubsidy[];
}

/**
 * Субсидии заказа по товарам — деньги, которые Маркет доплачивает продавцу.
 *
 * ⚠️ БЕРЁМ ЗАКАЗНЫЕ, А НЕ ПОЗИЦИОННЫЕ. У позиции `subsidies.amount` указана
 * сумма НА ЕДИНИЦУ товара, у заказа — итог. Проверено на боевом заказе
 * #58841189889: позиция «TQ-141-1D» с `count: 2` несёт
 * `YANDEX_CASHBACK 276 / SUBSIDY 565`, а заказ — `552 / 1130`, то есть ровно
 * вдвое. Сумма по позициям без умножения на count занизила бы выручку, а с
 * умножением легко посчитать дважды — заказные значения снимают вопрос вовсе.
 *
 * `DELIVERY` исключается: это вознаграждение за ДОСТАВКУ, а строка «Продажи»
 * считает только товары — тот же принцип, по которому `itemsTotal` не включает
 * `deliveryTotal`.
 */
export function subsidiesTotal(order: IOrderMoney): number {
  return (order?.subsidies ?? []).reduce(
    (sum, subsidy) =>
      subsidy?.type === SUBSIDY_TYPE.DELIVERY ? sum : sum + amount(subsidy?.amount),
    0,
  );
}

export interface IMoneyTotals {
  /** Сумма товаров. */
  items: number;
  /** Сумма товаров вместе с доставкой. */
  withDelivery: number;
}

export const ZERO_TOTALS: IMoneyTotals = { items: 0, withDelivery: 0 };

/** Число или мусор → число. `null`, `undefined` и NaN дают 0, а не NaN дальше. */
function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function orderTotals(order: IOrderMoney): IMoneyTotals {
  const items = amount(order?.itemsTotal);
  return { items, withDelivery: items + amount(order?.deliveryTotal) };
}

export function sumTotals(orders: readonly IOrderMoney[]): IMoneyTotals {
  return orders.reduce<IMoneyTotals>((acc, order) => {
    const totals = orderTotals(order);
    return {
      items: acc.items + totals.items,
      withDelivery: acc.withDelivery + totals.withDelivery,
    };
  }, ZERO_TOTALS);
}

export function addTotals(a: IMoneyTotals, b: IMoneyTotals): IMoneyTotals {
  return { items: a.items + b.items, withDelivery: a.withDelivery + b.withDelivery };
}

/**
 * Сумма в рублях для сообщения.
 *
 * Копейки округляются: продавцу в сводке за день они не нужны, а «12 345,67 ₽»
 * читается хуже, чем «12 346 ₽». Разряды разделяются неразрывным пробелом:
 * обычный Telegram может перенести по строке, разорвав число пополам.
 */
export function formatRubles(value: number): string {
  const rounded = Math.round(amount(value));
  // toLocaleString('ru-RU') разделяет разряды НЕРАЗРЫВНЫМ пробелом (U+00A0) —
  // и это то, что нужно: обычный пробел Telegram переносит по строке, разрывая
  // «1 234 567 ₽» посреди числа. Символ записан escape-последовательностью
  // намеренно: невидимый символ в исходнике не отличить от обычного пробела ни
  // глазами, ни в диффе.
  return `${rounded.toLocaleString('ru-RU')}\u00A0₽`;
}

/** Разделитель разрядов, который отдаёт ru-RU. Нужен тестам. */
export const NBSP = '\u00A0';

/** Сумма возврата приходит объектом {value, currencyId}, а не числом. */
export function amountValue(money: { value?: number } | undefined): number {
  return amount(money?.value);
}
