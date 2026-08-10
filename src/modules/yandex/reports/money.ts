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
 * Актуальные: `itemsTotal` (платёж покупателя за товары), `deliveryTotal`
 * (доставка) и `subsidies` (компенсация Маркета продавцу).
 *
 * ПРОДАЖА ПРОДАВЦА = `itemsTotal` + субсидии, и эта формула живёт ЗДЕСЬ —
 * в `orderTotals`, — а не у каждого отчёта своя. Скидку по акции даёт Маркет,
 * а продавцу её компенсирует, поэтому его выручка БОЛЬШЕ того, что заплатил
 * покупатель: на боевом магазине это +17,6 % на срезе «сейчас в пути»
 * (1 037 182 ₽ платежей и 182 876 ₽ субсидий, сверка 09-08-2026) и 421 тыс. ₽
 * на 2,46 млн за июль. Пока формула была написана руками в трёх местах
 * (прибыль, калькулятор — и нигде в отчётах о заказах), отчёты показывали
 * продавцу чужое число: цену покупателя вместо своей.
 *
 * Отдельного поля «платёж покупателя» в `IMoneyTotals` НЕТ намеренно. Два
 * похожих числа рядом — ровно та ловушка, о которой абзац выше: следующий
 * отчёт возьмёт не то, и это снова не упадёт, а молча разойдётся с кабинетом.
 * Платёж восстанавливается вычитанием: `sales − subsidies === itemsTotal`
 * (пиннится тестом), а в .xlsx для субсидий есть своя колонка.
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
 *
 * Зовётся из `orderTotals`. Прямых вызовов в отчётах быть не должно — иначе
 * формула продажи снова размножится по файлам, как это уже было.
 */
export function subsidiesTotal(order: IOrderMoney): number {
  return (order?.subsidies ?? []).reduce(
    (sum, subsidy) =>
      subsidy?.type === SUBSIDY_TYPE.DELIVERY ? sum : sum + amount(subsidy?.amount),
    0,
  );
}

export interface IMoneyTotals {
  /**
   * Продажа продавца — только товары: платёж покупателя ПЛЮС субсидии Маркета.
   * Не «сколько заплатил покупатель»: см. шапку модуля.
   */
  sales: number;
  /** Сколько из `sales` доплатил Маркет. Печатается строкой «в т.ч. субсидии». */
  subsidies: number;
  /** Продажа вместе с доставкой. */
  withDelivery: number;
}

export const ZERO_TOTALS: IMoneyTotals = { sales: 0, subsidies: 0, withDelivery: 0 };

/** Число или мусор → число. `null`, `undefined` и NaN дают 0, а не NaN дальше. */
function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function addTotals(a: IMoneyTotals, b: IMoneyTotals): IMoneyTotals {
  return {
    sales: a.sales + b.sales,
    subsidies: a.subsidies + b.subsidies,
    withDelivery: a.withDelivery + b.withDelivery,
  };
}

export function orderTotals(order: IOrderMoney): IMoneyTotals {
  const subsidies = subsidiesTotal(order);
  const sales = amount(order?.itemsTotal) + subsidies;
  return { sales, subsidies, withDelivery: sales + amount(order?.deliveryTotal) };
}

/**
 * Свод по списку — обязательно через `addTotals`.
 *
 * Раньше сложение полей было написано здесь второй раз, и новое поле пришлось
 * бы не забыть в двух сумматорах сразу. Забытое слагаемое не падает — оно молча
 * занижает итог отчёта, то есть ошибка ровно того класса, ради которого написан
 * весь модуль.
 */
export function sumTotals(orders: readonly IOrderMoney[]): IMoneyTotals {
  return orders.reduce<IMoneyTotals>(
    (acc, order) => addTotals(acc, orderTotals(order)),
    ZERO_TOTALS,
  );
}

/**
 * Подпись строки о субсидиях — ОДНА на все экраны.
 *
 * «Прибыль» и четыре отчёта о заказах печатают одно число одной формулы, и две
 * разные формулировки читались бы как два разных показателя (довод
 * menu.constants.ts: подписи живут в одном месте).
 */
export const SUBSIDIES_LABEL = 'в т.ч. субсидии Маркета';

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
