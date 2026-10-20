import type { IOzonPosting } from './ozon.client';
import type { TOrderStage } from '../../shared/order-stage';
import type { IMarketplaceOrder } from '../marketplaces/marketplace-adapter';

import { orderDayIso } from '../yandex/reports/order-day';

/** Схема отправления Ozon: FBS — склад продавца, FBO — склад Ozon. */
export type TOzonScheme = 'FBS' | 'FBO';

/**
 * Статусы отправлений Ozon (`filter.status` методов списка FBS и FBO) — полный
 * перечень по документации Ozon. На живом кабинете не сверен (known-gaps): новый
 * статус не угадывается, а уходит в `unknown` с записью в лог.
 */
export const OZON_POSTING_STATUSES = [
  'acceptance_in_progress',
  'awaiting_approve',
  'awaiting_registration',
  'awaiting_verification',
  'awaiting_packaging',
  'awaiting_deliver',
  'not_accepted',
  'sent_by_seller',
  'driver_pickup',
  'delivering',
  'arbitration',
  'client_arbitration',
  'delivered',
  'cancelled',
  'cancelled_from_split_pending',
] as const;

export type TOzonPostingStatus = (typeof OZON_POSTING_STATUSES)[number];

/**
 * Статус отправления Ozon → этап общего набора (ТЗ п.11). `Record` по полному
 * перечню: новый статус не скомпилируется без решения.
 *
 * - `awaiting_deliver` («ожидает отгрузки») — собран; `not_accepted` (не принят
 *   сортировочным центром) — тоже «собран»: товар у продавца, в доставку не ушёл.
 * - Арбитраж — спор о доставке, отправление ещё в пути с точки зрения денег.
 * - `delivered` — получен покупателем, то есть «выкуплен». Отдельного «лежит в
 *   пункте выдачи» в списке отправлений Ozon нет — он внутри `delivering`.
 * - «Возвращается» и «Возвращён» статусом отправления не выражаются: возвраты
 *   Ozon — отдельный метод, их этапы придут с аналитикой возвратов (TASK-145).
 */
export const OZON_POSTING_STAGE: Readonly<Record<TOzonPostingStatus, TOrderStage>> = {
  acceptance_in_progress: 'new',
  awaiting_approve: 'new',
  awaiting_registration: 'new',
  awaiting_verification: 'new',
  awaiting_packaging: 'awaiting_assembly',
  awaiting_deliver: 'assembled',
  not_accepted: 'assembled',
  sent_by_seller: 'handed_over',
  driver_pickup: 'handed_over',
  delivering: 'in_transit',
  arbitration: 'in_transit',
  client_arbitration: 'in_transit',
  delivered: 'redeemed',
  cancelled: 'cancelled',
  cancelled_from_split_pending: 'cancelled',
};

/** Этап по статусу; незнакомый — `unknown` (вызывающий пишет его в лог). */
export function ozonPostingStage(status: string): TOrderStage {
  return OZON_POSTING_STAGE[status as TOzonPostingStatus] ?? 'unknown';
}

/**
 * Отправление Ozon → наша сущность заказа. Строка — отправление, а не заказ
 * покупателя: у отправлений одного заказа свой склад, статус и состав.
 * Продажи — Σ цена × штуки рублёвых позиций; хоть одна без рублёвой цены —
 * null (ноль читался бы как бесплатный заказ).
 */
export function ozonMarketplaceOrder(
  posting: IOzonPosting,
  scheme: TOzonScheme,
): IMarketplaceOrder {
  const items = posting.products.map((product) => ({
    sku: product.offerId.trim(),
    name: product.name,
    count: product.quantity,
    price:
      product.price !== undefined && isRub(product.currency) && product.price >= 0
        ? product.price
        : null,
  }));
  const priced = items.every((item) => item.price !== null);
  return {
    marketplace: 'ozon',
    id: posting.postingNumber,
    orderNumber: posting.orderNumber || posting.postingNumber,
    scheme,
    stage: ozonPostingStage(posting.status),
    status: posting.status,
    substatus: posting.substatus || null,
    createdDay: orderDayIso(posting.inProcessAt),
    items,
    sales: priced
      ? Math.round(items.reduce((sum, item) => sum + (item.price ?? 0) * item.count, 0) * 100) / 100
      : null,
  };
}

/** Валюта цены Ozon. Пустая — валюта кабинета, у российского продавца рубли. */
function isRub(currency: string | undefined): boolean {
  return !currency || currency.toUpperCase() === 'RUB';
}
