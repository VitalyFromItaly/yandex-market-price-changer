/**
 * Частота прохода «Передачи остатков» по расписанию — выбирает продавец в CRM
 * (решение `stock_push_interval_by_seller`). Фичу `stock_push_schedule` по-прежнему
 * открывает владелец: частота решает «как часто», а не «можно ли».
 *
 * Чистые правила без импортов — их читают и схема Mongo, и планировщик, и CRM.
 */
export type TPushInterval = 'off' | '30m' | '1h' | '3h' | '6h';

/** Умолчание — прежние «каждые 30 минут» (`stock_push_schedule_every_30m`): без документа ничего не меняется. */
export const DEFAULT_PUSH_INTERVAL: TPushInterval = '30m';

/**
 * Cron по Москве. Чаще 30 минут не даём: проход читает каталог, остатки и заказы
 * всех площадок, а content API WB уже отвечал 429 (прод 406937947).
 */
export const PUSH_CRON_BY_INTERVAL: Record<Exclude<TPushInterval, 'off'>, string> = {
  '30m': '*/30 * * * *',
  '1h': '0 * * * *',
  '3h': '0 */3 * * *',
  '6h': '0 */6 * * *',
};

/** Подписи — одни для CRM и журнала. */
export const PUSH_INTERVAL_LABEL: Record<TPushInterval, string> = {
  off: 'выключена',
  '30m': 'каждые 30 минут',
  '1h': 'каждый час',
  '3h': 'каждые 3 часа',
  '6h': 'каждые 6 часов',
};

export function isPushInterval(value: unknown): value is TPushInterval {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(PUSH_INTERVAL_LABEL, value)
  );
}

/** Cron частоты; `off` — null (задачи нет). Мусор из базы — умолчание, а не выключение. */
export function pushCronOf(interval: unknown): string | null {
  const known = isPushInterval(interval) ? interval : DEFAULT_PUSH_INTERVAL;
  return known === 'off' ? null : PUSH_CRON_BY_INTERVAL[known];
}
