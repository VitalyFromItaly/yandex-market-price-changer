import type { IMarketplaceOrder, IMarketplaceOrderItem } from './marketplace-adapter';
import type { IReportOrder } from '../yandex/reports/order-reports.service';

import { orderTotals } from '../yandex/reports/money';
import { orderDayIso } from '../yandex/reports/order-day';
import { ymOrderStage } from '../yandex/reports/report-status-map';

/**
 * Заказ ЯМ → наша сущность (TASK-130). Деньги — `orderTotals` (одна формула на
 * все отчёты, с субсидиями Маркета), этап — `ymOrderStage` из файла маппинга
 * статусов, день — `orderDayIso` (все четыре формы дат Маркета). Ни одного
 * своего правила: заказ ЯМ через адаптер обязан совпадать с отчётами.
 *
 * `scheme` — модель магазина, у ЯМ одна на кампанию.
 */
export function ymMarketplaceOrder(order: IReportOrder, scheme: string | null): IMarketplaceOrder {
  const id = order?.id === undefined || order?.id === null ? '' : String(order.id);
  return {
    marketplace: 'ym',
    id,
    orderNumber: id,
    scheme: scheme ? scheme.toUpperCase() : null,
    stage: ymOrderStage(order),
    status: order?.status ?? '',
    substatus: order?.substatus || null,
    createdDay: orderDayIso(order?.creationDate),
    items: (order?.items ?? []).map(ymItem),
    sales: orderTotals(order).sales,
  };
}

function ymItem(item: NonNullable<IReportOrder['items']>[number]): IMarketplaceOrderItem {
  const price = Number(item?.price);
  return {
    sku: (item?.offerId ?? '').trim(),
    name: item?.offerName || undefined,
    count: Number(item?.count) || 0,
    price: item?.price !== undefined && Number.isFinite(price) ? price : null,
  };
}
