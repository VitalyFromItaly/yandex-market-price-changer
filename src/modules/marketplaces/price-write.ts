import type { IMarketplacePriceWriteResult, IPriceWriteUpdate } from './marketplace-adapter';

/**
 * Общие правила записи цен (TASK-200) — чистые функции, без HTTP. Сами запросы
 * и их порядок — в сервисах записи площадок.
 */

/**
 * Последний барьер перед HTTP: цена ≤ 0, дробная или нечисловая отменяет запись
 * целиком — как `assertStockCounts`. Домен уже округлил цены до рубля
 * (`price_set_round_rub`), так что дробь здесь — ошибка вызывающего, а не
 * продавца, и молча округлять её нельзя.
 */
export function assertPrices(updates: readonly IPriceWriteUpdate[]): void {
  const bad = updates.find((update) => !Number.isInteger(update.price) || update.price <= 0);
  if (bad) {
    throw new Error(
      `Цена «${bad.sku}» = ${String(bad.price)}: не целое положительное число — запись отменена целиком`,
    );
  }
}

/** Запись цен не ушла: env выключен. */
export function skippedPriceWrite(
  skipReason: IMarketplacePriceWriteResult['skipReason'],
): IMarketplacePriceWriteResult {
  return { written: 0, errors: [], skipped: [], skipReason };
}

/** Окно скидки от зачёркнутой цены, которое принимает Маркет (спека: 5–99%), в процентах. */
const YM_MIN_DISCOUNT_PCT = 5;
const YM_MAX_DISCOUNT_PCT = 99;

/**
 * Зачёркнутая цена ЯМ для новой цены (решение `price_set_ym_discount_base`).
 * Маркет снимает зачёркнутую, если её не прислать, поэтому текущая уходит
 * обратно как есть — пока новая цена остаётся в окне скидки 5–99%. Вне окна
 * (цена подросла до зачёркнутой или упала ниже 1% от неё) запрос с ней Маркет
 * отклонит — тогда она не шлётся и снимается. Своих скидок не придумываем.
 * Сравнение в целых процентах: `base × 0.01` в плавающей точке — не ровно 1%.
 */
export function ymDiscountBaseFor(
  price: number,
  discountBase: number | undefined,
): number | undefined {
  if (discountBase === undefined) return undefined;
  const inWindow =
    price * 100 <= discountBase * (100 - YM_MIN_DISCOUNT_PCT) &&
    price * 100 >= discountBase * (100 - YM_MAX_DISCOUNT_PCT);
  return inWindow ? discountBase : undefined;
}
