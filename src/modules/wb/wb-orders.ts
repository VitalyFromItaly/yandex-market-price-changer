import type { IWbFbsOrder, IWbFbsOrderStatus, IWbOrderRow, IWbSaleRow } from './wb.client';
import type { TOrderStage } from '../../shared/order-stage';
import type { IMarketplaceOrder } from '../marketplaces/marketplace-adapter';

import { orderDayIso } from '../yandex/reports/order-day';

/**
 * Статусы сборочного задания FBS со стороны продавца (`supplierStatus`) —
 * перечень по памяти о документации WB (доки автоматике отдают 498, known-gaps):
 * `new` — новое, `confirm` — на сборке, `complete` — в доставке, `cancel` —
 * отменено продавцом; `deliver`/`receive`/`reject` — у DBS (доставка силами
 * продавца). Новый статус не угадывается — `unknown` и строка в лог.
 */
export const WB_SUPPLIER_STATUSES = [
  'new',
  'confirm',
  'complete',
  'cancel',
  'deliver',
  'receive',
  'reject',
] as const;

export type TWbSupplierStatus = (typeof WB_SUPPLIER_STATUSES)[number];

export const WB_SUPPLIER_STATUS_STAGE: Readonly<Record<TWbSupplierStatus, TOrderStage>> = {
  new: 'new',
  confirm: 'awaiting_assembly',
  // Задание в поставке, переданной в доставку.
  complete: 'handed_over',
  cancel: 'cancelled',
  deliver: 'in_transit',
  receive: 'redeemed',
  // DBS: покупатель отказался при получении — товар едет назад.
  reject: 'returning',
};

/**
 * Статусы задания со стороны WB (`wbStatus`). `waiting` — «в работе», этап
 * тогда решает статус продавца (null). Остальные точнее статуса продавца и
 * побеждают его.
 */
export const WB_STATUSES = [
  'waiting',
  'sorted',
  'sold',
  'canceled',
  'canceled_by_client',
  'declined_by_client',
  'defect',
  'ready_for_pickup',
  'postponed_delivery',
  'accepted_by_carrier',
  'sent_to_carrier',
] as const;

export type TWbStatus = (typeof WB_STATUSES)[number];

export const WB_STATUS_STAGE: Readonly<Record<TWbStatus, TOrderStage | null>> = {
  waiting: null,
  // Отсортировано на складе WB — едет к покупателю.
  sorted: 'in_transit',
  sold: 'redeemed',
  canceled: 'cancelled',
  // Покупатель отменил до получения — отмена, а не отказ.
  canceled_by_client: 'cancelled',
  // Отказ при получении (решение `wb_refusal_by_fbs_status`): товар возвращается.
  declined_by_client: 'returning',
  // Отмена из-за брака: до покупателя не дошло.
  defect: 'cancelled',
  ready_for_pickup: 'delivered',
  postponed_delivery: 'in_transit',
  accepted_by_carrier: 'handed_over',
  sent_to_carrier: 'handed_over',
};

/** Этап FBS по паре статусов; незнакомое любое из двух — `unknown`. */
export function wbFbsStage(status: { supplierStatus: string; wbStatus: string }): TOrderStage {
  if (status.wbStatus) {
    if (!(status.wbStatus in WB_STATUS_STAGE)) return 'unknown';
    const byWb = WB_STATUS_STAGE[status.wbStatus as TWbStatus];
    if (byWb) return byWb;
  }
  return WB_SUPPLIER_STATUS_STAGE[status.supplierStatus as TWbSupplierStatus] ?? 'unknown';
}

/** Схема по `warehouseType` статистики. */
export function wbScheme(warehouseType: string): 'FBS' | 'FBW' | null {
  const type = warehouseType.toLowerCase();
  if (type.includes('продавц')) return 'FBS';
  if (type.includes('wb')) return 'FBW';
  return null;
}

/** Что известно о штуке товара из трёх источников. */
export interface IWbOrderFacts {
  srid: string;
  order?: IWbOrderRow;
  /** Последняя строка продаж: R… возврат, S… выкуп. */
  sale?: IWbSaleRow;
  fbs?: IWbFbsOrder;
  fbsStatus?: IWbFbsOrderStatus;
}

/**
 * Этап и исходный статус штуки. Приоритет — от окончательного к промежуточному:
 * возврат (R) → выкуп (S) → статус FBS → `isCancel` → заказ FBW без выкупа и
 * отмены — «в пути» (решение `wb_fbw_open_order_in_transit`: сборку и доставку
 * ведёт WB, своей очереди у продавца нет — довод FBY).
 *
 * FBW с `isCancel` — «отменён»: статистика не различает отмену до отгрузки и
 * отказ в пункте выдачи (known-gaps); у FBS их различает `wbStatus`.
 */
export function wbOrderStage(facts: IWbOrderFacts): {
  stage: TOrderStage;
  status: string;
  substatus: string | null;
} {
  const saleKind = facts.sale?.saleID.charAt(0).toUpperCase();
  if (saleKind === 'R')
    return { stage: 'returned', status: 'return', substatus: facts.sale.saleID };
  if (saleKind === 'S') return { stage: 'redeemed', status: 'sale', substatus: facts.sale.saleID };
  if (facts.fbsStatus) {
    return {
      stage: wbFbsStage(facts.fbsStatus),
      status: facts.fbsStatus.supplierStatus,
      substatus: facts.fbsStatus.wbStatus || null,
    };
  }
  if (facts.order?.isCancel) return { stage: 'cancelled', status: 'cancel', substatus: null };
  if (facts.order) return { stage: 'in_transit', status: 'ordered', substatus: null };
  // Задание FBS без статуса и без строки статистики — сказать нечего.
  return { stage: 'unknown', status: '', substatus: null };
}

/**
 * Штука товара WB → наша сущность заказа. Строка — `srid`: WB отгружает и
 * считает каждую штуку отдельно, у штук одной корзины свой статус. Корзина —
 * `orderNumber` (`gNumber`). Продажи — цена продавца со скидкой продавца, до
 * СПП: СПП — скидка за счёт WB, как субсидия Маркета в «Продажах» ЯМ.
 */
export function wbMarketplaceOrder(facts: IWbOrderFacts): IMarketplaceOrder {
  const { order, fbs } = facts;
  const { stage, status, substatus } = wbOrderStage(facts);
  const price = order ? order.priceWithDisc : (fbs?.price ?? null);
  const sku = (order?.supplierArticle || fbs?.article || '').trim();
  return {
    marketplace: 'wb',
    id: facts.srid,
    orderNumber: order?.gNumber || facts.srid,
    scheme: schemeOf(facts),
    stage,
    status,
    substatus,
    createdDay: orderDayIso(order?.date || fbs?.createdAt),
    items: [{ sku, name: order?.subject || undefined, count: 1, price }],
    sales: price,
  };
}

/** Схема: тип склада из статистики; задание FBS без строки статистики — FBS. */
function schemeOf({ order, fbs }: IWbOrderFacts): 'FBS' | 'FBW' | null {
  if (order) return wbScheme(order.warehouseType);
  return fbs ? 'FBS' : null;
}
