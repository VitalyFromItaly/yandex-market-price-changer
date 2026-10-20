/**
 * Произвольный период финансовых экранов (TASK-125): «Обзор» и «Прибыль»
 * «Финансов» считают журнал за любые дни, без 30-дневного окна Partner API.
 * Даты — «ГГГГ-ММ-ДД» по Москве; params задачи и query ссылки — `from`/`to`
 * (`parseDayRange` на бэкенде, там же потолок в год).
 */

import type { DayRange } from '@/shared/utils';

import { formatDay } from '@/shared/utils';

export const RANGE_PRESET = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7: '7d',
  LAST_30: '30d',
  MONTH: 'month',
  PREV_MONTH: 'prevmonth',
  CUSTOM: 'custom',
} as const;

export type RangePreset = (typeof RANGE_PRESET)[keyof typeof RANGE_PRESET];

/** Порядок и подписи — фильтры ТЗ п.1. */
export const RANGE_PRESET_OPTIONS: readonly { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'month', label: 'Этот месяц' },
  { value: 'prevmonth', label: 'Прошлый месяц' },
  { value: 'custom', label: 'Период' },
];

/** Потолок — как у сервера (`MAX_RANGE_DAYS`). */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** «ГГГГ-ММ-ДД» → полночь UTC; не настоящая дата — null. */
function msOf(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}

const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Сдвиг дня на n календарных дней. */
export function shiftDay(day: string, days: number): string {
  return isoOf((msOf(day) as number) + days * DAY_MS);
}

/** Дней в периоде включительно. */
export function rangeDays(range: DayRange): number {
  return ((msOf(range.to) as number) - (msOf(range.from) as number)) / DAY_MS + 1;
}

/** Период пресета на сегодня. «Свой» — null: его границы задаёт продавец. */
export function rangeOf(preset: RangePreset, today: string): DayRange | null {
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = shiftDay(today, -1);
      return { from: day, to: day };
    }
    case '7d':
      return { from: shiftDay(today, -6), to: today };
    case '30d':
      return { from: shiftDay(today, -29), to: today };
    case 'month':
      return { from: firstOfMonth, to: today };
    case 'prevmonth':
      return {
        from: shiftDay(firstOfMonth, -1).slice(0, 8) + '01',
        to: shiftDay(firstOfMonth, -1),
      };
    default:
      return null;
  }
}

/** Последний день месяца дня «ГГГГ-ММ-ДД». */
function monthEnd(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return isoOf(Date.UTC(year, month, 0));
}

/**
 * Период для динамики. Целый месяц — прошлый целый месяц; месяц с 1-го по
 * N-е — прошлый месяц с 1-го по то же число (или по его конец); остальное —
 * та же длина сразу перед. Иначе «этот месяц» сравнивался бы с последними
 * 15 днями, а не с прошлым месяцем.
 */
export function previousRange(range: DayRange): DayRange {
  if (range.from.slice(8) === '01' && range.from.slice(0, 7) === range.to.slice(0, 7)) {
    const prevFrom = `${shiftDay(range.from, -1).slice(0, 8)}01`;
    const prevEnd = monthEnd(prevFrom);
    if (range.to === monthEnd(range.from)) return { from: prevFrom, to: prevEnd };
    const sameDay = `${prevFrom.slice(0, 8)}${range.to.slice(8)}`;
    return { from: prevFrom, to: msOf(sameDay) !== null && sameDay < prevEnd ? sameDay : prevEnd };
  }
  const days = rangeDays(range);
  return { from: shiftDay(range.from, -days), to: shiftDay(range.from, -1) };
}

/** Период пригоден: настоящие даты, не задом наперёд, не позже сегодня, не длиннее года. */
export function isValidRange(range: { from: unknown; to: unknown }, today: string): boolean {
  const from = msOf(range.from);
  const to = msOf(range.to);
  if (from === null || to === null || from > to) return false;
  if ((range.to as string) > today) return false;
  return (to - from) / DAY_MS + 1 <= MAX_RANGE_DAYS;
}

export function sameRange(a: DayRange | null, b: DayRange | null): boolean {
  return a !== null && b !== null && a.from === b.from && a.to === b.to;
}

/** Ссылка «с тем же периодом»: `?from=&to=`. */
export function rangeQuery(range: DayRange): { from: string; to: string } {
  return { from: range.from, to: range.to };
}

/** Период из ссылки; мусор или будущее — null (раздел откроется со своим периодом). */
export function rangeFromQuery(query: Record<string, unknown>, today: string): DayRange | null {
  const range = { from: query.from, to: query.to };
  return isValidRange(range, today) ? (range as DayRange) : null;
}

/** «01-09-2026 — 30-09-2026», один день — одной датой. */
export function rangeLabel(range: DayRange): string {
  return range.from === range.to
    ? formatDay(range.from)
    : `${formatDay(range.from)} — ${formatDay(range.to)}`;
}
