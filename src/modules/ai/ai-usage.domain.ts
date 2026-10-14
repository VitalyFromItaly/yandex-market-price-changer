/**
 * Окна и дни страницы «ИИ» в админ-панели.
 *
 * Лист без импортов (паттерн health.domain.ts): чистая арифметика, тестируется
 * без Nest и Mongo. Свои окна, а не METRICS_RANGES: расход нужен и за месяц, а
 * у метрик 30 дней нет — и шаг там часы, а здесь календарные дни.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const AI_USAGE_RANGES = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS } as const;
export type TAiUsageRange = keyof typeof AI_USAGE_RANGES;

export function isAiUsageRange(value: unknown): value is TAiUsageRange {
  return typeof value === 'string' && Object.hasOwn(AI_USAGE_RANGES, value);
}

const MOSCOW_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Календарная дата `ГГГГ-ММ-ДД` по Москве — тот же вид, что $dateToString в summary. */
export function moscowDayKey(at: Date): string {
  return MOSCOW_DAY.format(at);
}

/**
 * Московские дни, которых касается окно, по порядку.
 *
 * Шаг — полдня с дедупликацией, а не сутки: окно «24h» с 15:00 до 15:00
 * задевает два календарных дня, и шаг в сутки от начала окна легко
 * перепрыгнул бы последний.
 */
export function moscowDays(since: Date, until: Date): string[] {
  const days: string[] = [];
  const push = (key: string) => {
    if (days[days.length - 1] !== key) days.push(key);
  };
  for (let at = since.getTime(); at < until.getTime(); at += DAY_MS / 2) {
    push(moscowDayKey(new Date(at)));
  }
  push(moscowDayKey(until));
  return days;
}

export interface IDaySpend {
  day: string;
  costRub: number;
  requests: number;
  errors: number;
}

/**
 * Нули в днях без запросов: Mongo пустых групп не отдаёт, а график без них
 * сдвинул бы столбцы, и «вчера» встало бы на место пустого позавчера.
 */
export function fillDays(days: readonly string[], spent: readonly IDaySpend[]): IDaySpend[] {
  const byDay = new Map(spent.map((row) => [row.day, row]));
  return days.map((day) => byDay.get(day) ?? { day, costRub: 0, requests: 0, errors: 0 });
}

/** Доля упавших запросов, 0…1. Нет запросов — null: «0 %» читалось бы как «всё хорошо». */
export function errorShare(errors: number, requests: number): number | null {
  return requests > 0 ? errors / requests : null;
}
