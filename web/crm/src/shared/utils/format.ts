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

/** Копейки финмодуля → «1 234,5 ₽». Суммы журнала хранятся целыми копейками. */
export function formatKopecks(kopecks: number): string {
  return formatRub(kopecks / 100);
}

/** Русское согласование: plural(3, ['операция', 'операции', 'операций']) → «операции». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
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

/** Неразрывный дефис: дата «13-10-2026» в подписи не рвётся на «13-» и «10-2026». */
const NB_HYPHEN = String.fromCharCode(0x2011);

/** Дефисы внутри дат ДД-ММ-ГГГГ — неразрывные; остальной текст не трогается. */
export function noBreakDates(text: string): string {
  return text.replace(/\b(\d{2})-(\d{2})-(\d{4})\b/g, `$1${NB_HYPHEN}$2${NB_HYPHEN}$3`);
}
