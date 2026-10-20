/**
 * Этап заказа в общем наборе площадок (ТЗ п.11, TASK-130) — лист без импортов:
 * его читают адаптеры площадок, будущий единый список заказов (TASK-144) и
 * фронт CRM, как `marketplace.ts`.
 *
 * Десять этапов ТЗ плюс `unknown`: статус, которого нет в таблице площадки,
 * не угадывается в соседний этап, а остаётся видимым как «неизвестно» — угадка
 * молча переложила бы заказ из «в пути» в «доставлен».
 */
export const ORDER_STAGES = [
  'new',
  'awaiting_assembly',
  'assembled',
  'handed_over',
  'in_transit',
  'delivered',
  'redeemed',
  'cancelled',
  'returning',
  'returned',
  'unknown',
] as const;

export type TOrderStage = (typeof ORDER_STAGES)[number];

/** Подписи этапов — дословно ТЗ п.11. `Record`, чтобы новый этап не остался без подписи. */
export const ORDER_STAGE_LABEL: Readonly<Record<TOrderStage, string>> = {
  new: 'Новый',
  awaiting_assembly: 'Ожидает сборки',
  assembled: 'Собран',
  handed_over: 'Передан в доставку',
  in_transit: 'В пути',
  delivered: 'Доставлен',
  redeemed: 'Выкуплен',
  cancelled: 'Отменён',
  returning: 'Возвращается',
  returned: 'Возвращён',
  unknown: 'Неизвестно',
};

export function isOrderStage(value: unknown): value is TOrderStage {
  return typeof value === 'string' && (ORDER_STAGES as readonly string[]).includes(value);
}
