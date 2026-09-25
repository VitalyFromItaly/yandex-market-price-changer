/**
 * Форматирование чисел, пришедших с сервера. Только вид: сами суммы считает
 * бэкенд (orderTotals), фронт их не пересчитывает — иначе CRM разойдётся с
 * ботом «на рубль».
 */

/** Неразрывный пробел: «₽» не должен уезжать на новую строку отдельно от числа. */
const NBSP = String.fromCharCode(0xa0);

const RUB = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** «1 234,5 ₽» — копейки печатаются, только когда они есть, как у бота. */
export function formatRub(value: number): string {
  return `${RUB.format(value)}${NBSP}₽`;
}

export function formatCount(value: number): string {
  return COUNT.format(value);
}

const MOSCOW_DATE = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** «24-09-2026» по Москве — как даты в боте. Битая строка — `null`, не «Invalid Date». */
export function formatMoscowDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return MOSCOW_DATE.format(date).replace(/\./g, '-');
}

const MOSCOW_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Момент, на который данные на экране: «14:32», если это сегодня по Москве,
 * иначе «24-09-2026 14:32». Битая строка — `null`.
 */
export function formatSavedAt(iso: string, now: Date = new Date()): string | null {
  const date = formatMoscowDate(iso);
  if (date === null) return null;
  const time = MOSCOW_TIME.format(new Date(iso));
  return date === formatMoscowDate(now.toISOString()) ? time : `${date} ${time}`;
}
