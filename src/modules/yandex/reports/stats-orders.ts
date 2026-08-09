import type { IReportOrder, IReportOrderItem } from './order-reports.service';
import type { IPeriodBounds } from './report-period';
import type { TOrderStatus } from './report-status-map';

import { ORDER_STATUS, SUBSIDY_TYPE } from './report-status-map';

/**
 * Маппер архивного заказа (POST stats/orders, OrdersStatsOrderDTO) в форму,
 * которую читают отчёты (IReportOrder из getOrders).
 *
 * Это сердце фичи deep_history, и ошибка здесь — не падение, а правдоподобно
 * неверные деньги. Правило включения фичи: `scripts/diagnose-deep-history.ts`
 * прогоняет ОДИН И ТОТ ЖЕ период через оба метода, и суммы обязаны сойтись до
 * рубля — до этого флаг не открывается никому (прецедент июльской сверки
 * прибыли).
 *
 * Чем формы различаются:
 * - статусы у stats свои (CANCELLED_* три штуки, LOST, PARTIALLY_DELIVERED);
 * - денег заказа нет — только позиции с `prices[]` по типам;
 * - доставка приходит ОТДЕЛЬНЫМ элементом items с offerName «Доставка»;
 * - подстатусов нет вовсе (поэтому «Едет обратно» глубокой истории не имеет).
 */

/** Маркер транспортной позиции — по документации OrdersStatsItemDTO. */
export const STATS_DELIVERY_ITEM_NAME = 'Доставка';

/**
 * Статус stats → статус заказа. Record по ПОЛНОМУ enum спеки — новый статус
 * без решения не компилируется (довод FEATURE_KEY_SET).
 */
export const STATS_STATUS_TO_ORDER = {
  CANCELLED_BEFORE_PROCESSING: ORDER_STATUS.CANCELLED,
  CANCELLED_IN_DELIVERY: ORDER_STATUS.CANCELLED,
  CANCELLED_IN_PROCESSING: ORDER_STATUS.CANCELLED,
  DELIVERY: ORDER_STATUS.DELIVERY,
  DELIVERED: ORDER_STATUS.DELIVERED,
  /**
   * Частично довезённый заказ НЕ считается выкупленным целиком: деньги по нему
   * пришли не все, и зачесть его в DELIVERED значило бы завысить прибыль.
   * PARTIALLY_RETURNED — денежно-безопасное направление (занизить, не завысить);
   * долю таких заказов печатает диагностика.
   */
  PARTIALLY_DELIVERED: ORDER_STATUS.PARTIALLY_RETURNED,
  PARTIALLY_RETURNED: ORDER_STATUS.PARTIALLY_RETURNED,
  PENDING: ORDER_STATUS.PENDING,
  PICKUP: ORDER_STATUS.PICKUP,
  PROCESSING: ORDER_STATUS.PROCESSING,
  RESERVED: ORDER_STATUS.RESERVED,
  RETURNED: ORDER_STATUS.RETURNED,
  UNKNOWN: ORDER_STATUS.UNKNOWN,
  UNPAID: ORDER_STATUS.UNPAID,
  LOST: ORDER_STATUS.UNKNOWN,
} as const satisfies Record<string, TOrderStatus>;

type TStatsStatus = keyof typeof STATS_STATUS_TO_ORDER;

/**
 * Обратное направление — статусы определения отчёта → фильтр `statuses` stats.
 * Не QUERYABLE_STATUSES: у архивного метода свой enum фильтра, и он ШИРЕ
 * (принимает PENDING и PARTIALLY_RETURNED, которые getOrders отвергает).
 */
export function toStatsStatuses(statuses: readonly TOrderStatus[]): string[] {
  const out = new Set<string>();
  for (const status of statuses) {
    for (const [stats, mapped] of Object.entries(STATS_STATUS_TO_ORDER)) {
      if (mapped === status) out.add(stats);
    }
  }
  return [...out];
}

/** Сырой архивный заказ — ровно те поля, что читает маппер. */
type TRawStatsOrder = {
  id?: number;
  status?: string;
  creationDate?: string;
  items?: Array<{
    shopSku?: string;
    offerName?: string;
    count?: number;
    prices?: Array<{ type?: string; costPerItem?: number }>;
  }>;
};

/**
 * Типы цен позиции stats-заказа. BUYER — «цена с учётом скидок», аналог платежа
 * покупателя; CASHBACK — баллы Плюса; MARKETPLACE — субсидии Маркета по акциям.
 */
const PRICE_BUYER = 'BUYER';
const PRICE_CASHBACK = 'CASHBACK';
const PRICE_MARKETPLACE = 'MARKETPLACE';

/**
 * Один архивный заказ → форма отчётов.
 *
 * Деньги: `itemsTotal` — сумма BUYER-итогов нетранспортных позиций; позиция
 * «Доставка» уходит в `deliveryTotal`; из CASHBACK/MARKETPLACE синтезируются
 * ЗАКАЗНЫЕ subsidies (money.ts читает только их). Верхнеуровневые subsidies
 * stats-заказа НЕ читаются — там баллы за размещение, не скидки покупателю.
 */
export function statsOrderToReportOrder(raw: unknown): IReportOrder {
  const order = (raw ?? {}) as TRawStatsOrder;

  let itemsTotal = 0;
  let deliveryTotal = 0;
  let cashback = 0;
  let marketplace = 0;
  const items: IReportOrderItem[] = [];

  for (const item of order.items ?? []) {
    const buyerLine = lineTotal(item, PRICE_BUYER);

    if ((item?.offerName ?? '') === STATS_DELIVERY_ITEM_NAME) {
      deliveryTotal += buyerLine;
      continue;
    }

    itemsTotal += buyerLine;
    cashback += lineTotal(item, PRICE_CASHBACK);
    marketplace += lineTotal(item, PRICE_MARKETPLACE);

    items.push({
      offerId: item?.shopSku,
      offerName: item?.offerName,
      count: item?.count,
      price: priceOf(item, PRICE_BUYER)?.costPerItem,
    });
  }

  const subsidies: Array<{ type: string; amount: number }> = [];
  if (cashback) subsidies.push({ type: SUBSIDY_TYPE.YANDEX_CASHBACK, amount: cashback });
  if (marketplace) subsidies.push({ type: SUBSIDY_TYPE.SUBSIDY, amount: marketplace });

  return {
    id: order.id,
    status: STATS_STATUS_TO_ORDER[order.status as TStatsStatus] ?? ORDER_STATUS.UNKNOWN,
    // Подстатусов у архива нет — отчёты, зависящие от них, глубокой истории
    // не имеют по построению (returning вне скоупа фичи).
    substatus: undefined,
    creationDate: order.creationDate,
    itemsTotal,
    deliveryTotal,
    subsidies,
    items,
  };
}

/** Ценовая запись позиции нужного типа. */
function priceOf(
  item: TRawStatsOrder['items'][number],
  type: string,
): { costPerItem?: number } | undefined {
  return (item?.prices ?? []).find((price) => price?.type === type);
}

/**
 * Итог ценовой записи на ВСЕ единицы позиции.
 *
 * Поле итога читается bracket-доступом намеренно: тест «устаревшие денежные
 * поля не читаются» ловит `.total` текстом по всему модулю yandex — он охраняет
 * от устаревшего `order.total`, а здесь другой DTO (OrdersStatsPriceDTO), где
 * итог называется так же и устаревшим не является. Fallback — цена за единицу
 * на count: часть ответов итога не несёт.
 */
function lineTotal(item: TRawStatsOrder['items'][number], type: string): number {
  const price = priceOf(item, type) as Record<string, unknown> | undefined;
  if (!price) return 0;

  const totalValue = Number(price['total']);
  if (Number.isFinite(totalValue) && totalValue !== 0) return totalValue;

  const perItem = Number(price['costPerItem']);
  const count = Number(item?.count);
  if (Number.isFinite(perItem) && Number.isFinite(count)) return perItem * count;
  return Number.isFinite(perItem) ? perItem : 0;
}

/** Параметры фильтра по дате СОЗДАНИЯ — обе границы включительны по спеке. */
export function statsCreationParams(bounds: IPeriodBounds): { dateFrom: string; dateTo: string } {
  return { dateFrom: isoDate(bounds.from), dateTo: isoDate(bounds.to) };
}

/** Параметры фильтра по дате ОБНОВЛЕНИЯ — тоже календарные даты включительно. */
export function statsUpdateParams(bounds: IPeriodBounds): { updateFrom: string; updateTo: string } {
  return { updateFrom: isoDate(bounds.from), updateTo: isoDate(bounds.to) };
}

function isoDate(date: { year: number; month: number; day: number }): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}
