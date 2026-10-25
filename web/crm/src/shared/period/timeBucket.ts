/**
 * Корзины временного ряда — одно правило для «Аналитики продаж» и дашборда
 * «Площадки»: недели с понедельника, месяцы календарные. Иначе одна неделя на
 * двух экранах начиналась бы в разные дни, и суммы не сошлись бы.
 */

/** Шаг ряда: дни, недели (с понедельника), календарные месяцы. */
export type TimeGrain = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** «2026-09-24» → «24-09». */
const shortDay = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;

/** Ключ корзины дня: сам день, понедельник его недели или месяц. */
export function bucketKey(day: string, grain: TimeGrain): string {
  if (grain === 'day') return day;
  if (grain === 'month') return day.slice(0, 7);
  const ms = dayMs(day);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // понедельник — 0
  return isoOf(ms - weekday * DAY_MS);
}

/** Подпись корзины по её первому и последнему дню внутри периода. */
export function bucketLabel(grain: TimeGrain, first: string, last: string): string {
  if (grain === 'day') return shortDay(first);
  if (grain === 'month') return `${first.slice(5, 7)}-${first.slice(0, 4)}`;
  return first === last ? shortDay(first) : `${shortDay(first)}–${shortDay(last)}`;
}
