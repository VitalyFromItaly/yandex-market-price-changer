/**
 * Период отчёта — общий для разделов «Отчёты» и «Прибыль»: те же пять
 * вариантов, что кнопки периода в боте, и тот же формат params фоновой задачи
 * (`parsePeriodParams` на бэкенде).
 */

/** Глубина getOrders — HISTORY_WINDOW_DAYS на бэкенде. */
export const HISTORY_WINDOW_DAYS = 30;

export const PERIOD = {
  TODAY: 'today',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  ALL: 'all',
} as const;

export type PeriodKey = (typeof PERIOD)[keyof typeof PERIOD];

/** Подписи — как кнопки периода в боте (periodButtonLabel), без эмодзи. */
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: 'Сегодня',
  day: 'Другой день',
  week: 'С начала недели',
  month: 'С 1 числа месяца',
  all: 'Всего',
};

/** Выбранный период. `day` — ДД-ММ-ГГГГ, только у `day`. */
export interface ReportPeriod {
  key: PeriodKey;
  day: string | null;
}

export const DEFAULT_PERIOD: ReportPeriod = { key: PERIOD.TODAY, day: null };

const MOSCOW_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Сегодня по Москве в ГГГГ-ММ-ДД — формат `<input type="date">`. */
export function moscowTodayIso(now: Date = new Date()): string {
  return MOSCOW_ISO.format(now);
}

/**
 * Самый ранний день, который можно выбрать, или null — без ограничения.
 * Сервер проверяет глубину сам; здесь — чтобы не вести продавца в отказ.
 */
export function minDayIso(unlimited: boolean, now: Date = new Date()): string | null {
  if (unlimited) return null;
  // Полночь UTC календарного дня Москвы: арифметика по дням без часовых поясов.
  const earliest = new Date(`${moscowTodayIso(now)}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - HISTORY_WINDOW_DAYS);
  return earliest.toISOString().slice(0, 10);
}

/** ГГГГ-ММ-ДД → ДД-ММ-ГГГГ (формат бота и API CRM); мусор — null. */
export function isoToDay(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** ДД-ММ-ГГГГ → ГГГГ-ММ-ДД для `<input type="date">`. */
export function dayToIso(day: string | null): string {
  const match = day === null ? null : /^(\d{2})-(\d{2})-(\d{4})$/.exec(day);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

/** params фоновой задачи. */
export function periodParams(period: ReportPeriod): Record<string, unknown> {
  return period.key === PERIOD.DAY ? { period } : { period: { key: period.key } };
}

export function samePeriod(a: ReportPeriod, b: ReportPeriod): boolean {
  return a.key === b.key && (a.key !== PERIOD.DAY || a.day === b.day);
}

/**
 * Период в query ссылки на отчёт (`?period=month`, `?period=day&day=ДД-ММ-ГГГГ`):
 * число на главной ведёт в отчёт с тем же периодом, а сам период живёт в сторе
 * страницы, не в URL.
 */
export function periodQuery(period: ReportPeriod): Record<string, string> {
  return period.key === PERIOD.DAY && period.day !== null
    ? { period: period.key, day: period.day }
    : { period: period.key };
}

const PERIOD_KEYS = new Set<string>(Object.values(PERIOD));

function single(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

/** Период из query; нет, мусор или «день» без даты — null (страница остаётся на своём). */
export function periodFromQuery(query: Record<string, unknown>): ReportPeriod | null {
  const key = single(query.period);
  if (key === null || !PERIOD_KEYS.has(key)) return null;
  if (key !== PERIOD.DAY) return { key: key as PeriodKey, day: null };
  const day = single(query.day);
  return day !== null && /^\d{2}-\d{2}-\d{4}$/.test(day) ? { key: PERIOD.DAY, day } : null;
}
