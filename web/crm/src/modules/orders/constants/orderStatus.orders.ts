import type { OrderRowType } from '../orders.domain';

/**
 * Русские подписи кодов Маркета. xlsx печатает коды как есть (у книги схема
 * бота), а экрану нужны слова. Неизвестный код показывается сам собой — лучше
 * «NEW_STATUS», чем пустая ячейка.
 */
export const STATUS_LABEL: Readonly<Record<string, string>> = {
  // Статусы заказа.
  UNPAID: 'Не оплачен',
  PROCESSING: 'Собирается',
  DELIVERY: 'В доставке',
  PICKUP: 'В пункте выдачи',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
  RETURNED: 'Возвращён',
  PARTIALLY_RETURNED: 'Частично возвращён',
  // Подстатусы невыкупа.
  COURIER_RETURNS_ORDER: 'Курьер везёт обратно',
  COURIER_RETURNED_ORDER: 'Курьер вернул',
  DELIVERY_SERIVCE_UNDELIVERED: 'Не доставлен',
  DELIVERY_SERVICE_UNDELIVERED: 'Не доставлен',
  FULL_NOT_RANSOM: 'Не выкуплен',
  // Где едет возврат.
  CREATED: 'Заявлен',
  RECEIVED: 'Принят у покупателя',
  IN_TRANSIT: 'Едет к вам',
  READY_FOR_PICKUP: 'Ждёт в пункте',
  PICKED: 'Выдан магазину',
};

export function statusLabel(code: string): string {
  return STATUS_LABEL[code] ?? code;
}

export const ROW_TYPE_LABEL: Readonly<Record<OrderRowType, string>> = {
  order: 'Заказ',
  nonRedemption: 'Невыкуп',
  return: 'Возврат',
};
