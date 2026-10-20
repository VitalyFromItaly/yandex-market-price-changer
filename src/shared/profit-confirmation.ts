/**
 * Неподтверждённая прибыль (TASK-119, ТЗ п.6) — один признак на оба движка.
 *
 * «Прибыль» (`profitOf`) исключает заказ без закупа на дату целиком: в чистой
 * его нет. P&L журнала (`pnlOf`) выручку оставляет (решение
 * `pnl_unknown_cost_keeps_revenue`), и тогда чистая завышена. В обоих случаях
 * продавцу нельзя показывать чистую как подтверждённую, и в обоих экран обязан
 * сказать, сколько заказов и на какую сумму вне расчёта. Раньше каждый экран
 * собирал эту пометку сам, и «Обзор» печатал её без числа и суммы.
 *
 * Лист без импортов (паттерн `telegram-html.ts`): его импортируют и бэкенд, и
 * CRM-бандл, поэтому текст и правило одни.
 *
 * Деньги — копейки.
 */

export interface IUnconfirmedProfit {
  /** false — часть проданного вне подтверждённой прибыли. Выводится из остальных полей. */
  confirmed: boolean;
  /** Заказов вне расчёта. */
  orders: number;
  /** Их продажи, копейки. */
  revenueKopecks: number;
  /** Артикулы без закупа на дату продажи, без повторов. */
  skus: string[];
}

export const UNCONFIRMED_PROFIT_LABEL = 'Прибыль не подтверждена';

/** Причина по умолчанию; у «Калькулятора» их две (закуп и категория) — передаёт свою. */
export const UNCONFIRMED_REASON = 'нет закупа на дату продажи';

/** Подпись позиции без артикула — сопоставить её с прайсом нечем. */
export const NO_SKU_LABEL = '(без артикула)';

/**
 * Признак из счётчиков. `confirmed` не передаётся, а выводится: иначе
 * вызывающий мог бы сказать «подтверждено» при ненулевом числе заказов.
 */
export function unconfirmedOf(
  orders: number,
  revenueKopecks: number,
  skus: readonly string[],
): IUnconfirmedProfit {
  const unique = [...new Set(skus.map((sku) => sku || NO_SKU_LABEL))];
  return {
    confirmed: orders === 0 && unique.length === 0,
    orders,
    revenueKopecks,
    skus: unique,
  };
}

/** Два набора одного отчёта (оформленные и выкупленные) — один признак. */
export function mergeUnconfirmed(
  a: IUnconfirmedProfit | null | undefined,
  b: IUnconfirmedProfit | null | undefined,
): IUnconfirmedProfit {
  return unconfirmedOf(
    (a?.orders ?? 0) + (b?.orders ?? 0),
    (a?.revenueKopecks ?? 0) + (b?.revenueKopecks ?? 0),
    [...(a?.skus ?? []), ...(b?.skus ?? [])],
  );
}

function ordersWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'заказ';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'заказа';
  return 'заказов';
}

/**
 * «Прибыль не подтверждена: 3 заказа на 12 345 ₽ — нет закупа на дату продажи».
 * Без заказов, но с артикулами (P&L: у строки нет номера заказа) — число
 * артикулов. `null` — прибыль подтверждена, говорить нечего.
 */
export function unconfirmedSummary(
  unconfirmed: IUnconfirmedProfit | null | undefined,
  formatMoney: (kopecks: number) => string,
  reason = UNCONFIRMED_REASON,
): string | null {
  if (!unconfirmed || unconfirmed.confirmed) return null;
  const what = unconfirmed.orders
    ? `${unconfirmed.orders} ${ordersWord(unconfirmed.orders)} на ${formatMoney(unconfirmed.revenueKopecks)}`
    : `${unconfirmed.skus.length} арт.`;
  return `${UNCONFIRMED_PROFIT_LABEL}: ${what} — ${reason}`;
}
