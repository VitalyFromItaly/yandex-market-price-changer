/**
 * Календарные дни «ГГГГ-ММ-ДД» по Москве — периоды финансовых разделов
 * («Расходы», «Закупки»). Один набор правил на оба раздела: свой пресет у
 * каждого разошёлся бы, и «этот месяц» значил бы на двух экранах разное.
 */

export type DayRangePreset = 'month' | 'prevmonth' | 'week';

export interface DayRange {
  from: string;
  to: string;
}

export const DAY_RANGE_PRESETS: readonly { value: DayRangePreset; label: string }[] = [
  { value: 'month', label: 'Этот месяц' },
  { value: 'prevmonth', label: 'Прошлый месяц' },
  { value: 'week', label: 'Эта неделя' },
];

const MOSCOW_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Сегодня по Москве, «ГГГГ-ММ-ДД» — календарь продавца, а не часовой пояс браузера. */
export function moscowToday(now: Date = new Date()): string {
  return MOSCOW_ISO.format(now);
}

/** «2026-10-01» → «01-10-2026», как даты в боте. */
export function formatDay(iso: string): string {
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Границы пресета. Месяц — целиком, с будущими днями: число месяца тогда
 * сверяется с таблицей записей глазами. Неделя — понедельник…воскресенье.
 */
export function presetRange(preset: DayRangePreset, today: string): DayRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  if (preset === 'week') {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    const monday = new Date(Date.UTC(year, month - 1, day - weekday + 1));
    const sunday = new Date(Date.UTC(year, month - 1, day - weekday + 7));
    return { from: iso(monday), to: iso(sunday) };
  }
  const shift = preset === 'prevmonth' ? -1 : 0;
  const first = new Date(Date.UTC(year, month - 1 + shift, 1));
  const last = new Date(Date.UTC(year, month + shift, 0));
  return { from: iso(first), to: iso(last) };
}
