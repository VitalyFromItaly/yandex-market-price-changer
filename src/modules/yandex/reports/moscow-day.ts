/**
 * Границы «сегодня» по московскому времени.
 *
 * Считать сутки по времени сервера нельзя: приложение живёт в контейнере с UTC,
 * и с 21:00 до 00:00 МСК «сегодня» на сервере — это уже завтра в Москве.
 * Продавец в 22:30 получил бы отчёт за следующий день, то есть пустой, и это
 * выглядело бы как «сегодня ничего не отгрузили».
 *
 * Смещение НЕ зашито числом: с 2014 года Россия не переводит часы, но зашитая
 * константа — это ровно та мина, которая срабатывает через годы. Смещение
 * берётся у Intl для конкретной даты.
 */

export const MOSCOW_TIME_ZONE = 'Europe/Moscow';

export interface IMoscowDay {
  /** Календарная дата в Москве. */
  year: number;
  month: number;
  day: number;
  /** Смещение вида «+03:00». */
  offset: string;
}

/** Календарные части даты в московском часовом поясе. */
export function moscowDay(now: Date = new Date()): IMoscowDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    offset: moscowOffset(now),
  };
}

/**
 * Смещение Москвы на конкретный момент. Через Intl, а не константой: если
 * правила часового пояса когда-нибудь снова изменятся, обновление tzdata
 * подхватится само.
 */
export function moscowOffset(now: Date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: MOSCOW_TIME_ZONE,
    timeZoneName: 'longOffset',
  }).format(now);

  // Формат вида «7/29/2026, GMT+03:00».
  const match = formatted.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : '+03:00';
}

/** Формат fromDate/toDate и supplierShipmentDate — DD-MM-YYYY. */
export function moscowDateParam(now: Date = new Date()): string {
  const { year, month, day } = moscowDay(now);
  return `${pad(day)}-${pad(month)}-${year}`;
}

/**
 * Границы московских суток в ISO 8601 со смещением — формат, которого требуют
 * updatedAtFrom/updatedAtTo. Именно со смещением: без него Яндекс истолкует
 * время как UTC и отчёт сдвинется на три часа.
 */
export function moscowDayBounds(now: Date = new Date()): { from: string; to: string } {
  const { year, month, day, offset } = moscowDay(now);
  const date = `${year}-${pad(month)}-${pad(day)}`;
  return {
    from: `${date}T00:00:00${offset}`,
    to: `${date}T23:59:59${offset}`,
  };
}

/** Момент начала московских суток как Date — для проверки окна истории. */
export function moscowDayStart(now: Date = new Date()): Date {
  return new Date(moscowDayBounds(now).from);
}

// --- календарная арифметика --------------------------------------------------
//
// Считается по КАЛЕНДАРНЫМ частям московской даты, а не сдвигом Date на
// 24 * 60 * 60 * 1000. Арифметика в миллисекундах — обычный источник ошибок «на
// один день»: она предполагает, что сутки всегда ровно 24 часа, и промахивается
// на границах месяца и года. Здесь же день недели и «первое число» берутся из
// самой даты, где ошибиться нечему.

/** Календарная дата без времени и часового пояса. */
export interface ICalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * День недели московской даты: 1 — понедельник, 7 — воскресенье.
 *
 * Считается через `Date.UTC` от календарных частей — это чистая арифметика
 * календаря, часовой пояс в неё не вмешивается. Брать `getUTCDay()` у момента
 * московской полуночи нельзя: в UTC это 21:00 ПРЕДЫДУЩИХ суток, и половину
 * года неделя начиналась бы на день раньше.
 */
export function moscowWeekday(date: ICalendarDate): number {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Сдвиг календарной даты на N дней. Переносы месяца и года делает сам Date. */
export function shiftDays(date: ICalendarDate, days: number): ICalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Понедельник той недели, в которую попадает дата. */
export function startOfWeek(date: ICalendarDate): ICalendarDate {
  return shiftDays(date, -(moscowWeekday(date) - 1));
}

/** Первое число того же месяца. */
export function startOfMonth(date: ICalendarDate): ICalendarDate {
  return { year: date.year, month: date.month, day: 1 };
}

/** DD-MM-YYYY — формат fromDate/toDate и supplierShipmentDate. */
export function calendarDateParam(date: ICalendarDate): string {
  return `${pad(date.day)}-${pad(date.month)}-${date.year}`;
}

/**
 * Границы произвольной московской даты в ISO 8601 со смещением — формат
 * updatedAtFrom/updatedAtTo. Смещение берётся на момент `now`: в России часы не
 * переводят с 2014 года, а если правила вернут, tzdata подхватится сама.
 */
export function calendarDayBounds(
  date: ICalendarDate,
  now: Date = new Date(),
): { from: string; to: string } {
  const offset = moscowOffset(now);
  const iso = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  return { from: `${iso}T00:00:00${offset}`, to: `${iso}T23:59:59${offset}` };
}

/** Момент начала московских суток указанной даты — для проверки окна истории. */
export function calendarDayStart(date: ICalendarDate, now: Date = new Date()): Date {
  return new Date(calendarDayBounds(date, now).from);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
