import {
  calendarDateParam,
  calendarDayBounds,
  calendarDayStart,
  moscowDay,
  shiftDays,
  startOfMonth,
  startOfWeek,
  type ICalendarDate,
} from './moscow-day';
import { HISTORY_WINDOW_DAYS } from '../yandex-api.paths';
import { YandexDateRangeError, daysBetween } from '../yandex-date-window';

/**
 * Период отчёта.
 *
 * ЧИСТЫЙ модуль: ни telegraf, ни Mongo, ни сети. Периоды — это календарная
 * арифметика плюс формат параметров Partner API, и то и другое проверяется
 * обычными юнит-тестами. Ровно по той же причине рядом живут
 * report-status-map.ts и moscow-day.ts.
 *
 * ⚠️ Глубина ограничена АПИ, а не нами: `getOrders` не отдаёт заказы старше
 * 30 дней и не принимает диапазон длиннее 30 дней. Поэтому «за всё время»
 * здесь нет — вместо молча неполного отчёта пользователь получает внятный
 * отказ. История глубже — только через POST v1/businesses/{id}/orders,
 * который в клиенте пока не реализован.
 */

export const PERIOD = {
  /** Текущие московские сутки. */
  TODAY: 'today',
  /** Конкретный день, названный пользователем. */
  DAY: 'day',
  /** С понедельника текущей недели по сегодня. */
  WEEK: 'week',
  /** С первого числа текущего месяца по сегодня. */
  MONTH: 'month',
} as const;

export type TPeriodKey = (typeof PERIOD)[keyof typeof PERIOD];

/**
 * Выбранный период. Для `day` обязателен `day` — календарная дата; для
 * остальных он игнорируется.
 */
export interface IReportPeriod {
  key: TPeriodKey;
  day?: ICalendarDate;
}

export const DEFAULT_PERIOD: IReportPeriod = { key: PERIOD.TODAY };

/**
 * Периоды, доступные в РАССЫЛКЕ.
 *
 * `day` сюда не входит осознанно: конкретная дата в ежедневной задаче — это
 * отчёт, который завтра пришлёт ровно те же числа, что сегодня. Для повторяемой
 * рассылки осмысленны только периоды, отсчитываемые от «сейчас».
 */
export const SCHEDULE_PERIODS: readonly TPeriodKey[] = [PERIOD.TODAY, PERIOD.WEEK, PERIOD.MONTH];

/** Границы периода в календарных датах Москвы. */
export interface IPeriodBounds {
  from: ICalendarDate;
  to: ICalendarDate;
}

export function periodBounds(period: IReportPeriod, now: Date = new Date()): IPeriodBounds {
  const today = moscowDay(now);

  switch (period.key) {
    case PERIOD.DAY: {
      // Без даты период вырождается в «сегодня»: пустой день — это ошибка
      // вызывающего кода, но отчёт всё равно должен получиться осмысленным.
      const day = period.day ?? today;
      return { from: day, to: day };
    }
    case PERIOD.WEEK:
      return { from: startOfWeek(today), to: today };
    case PERIOD.MONTH:
      return { from: startOfMonth(today), to: today };
    default:
      return { from: today, to: today };
  }
}

/** Параметры Partner API для фильтра `supplierShipmentDate` (DD-MM-YYYY). */
export function shipmentDateParams(
  period: IReportPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  const bounds = periodBounds(period, now);
  return { from: calendarDateParam(bounds.from), to: calendarDateParam(bounds.to) };
}

/**
 * Параметры Partner API для фильтра по дате ОФОРМЛЕНИЯ — fromDate/toDate
 * (DD-MM-YYYY).
 *
 * ⚠️ Верхняя граница сдвинута на день вперёд НАМЕРЕННО. По документации
 * `toDate` — это «заказы, созданные ДО 00:00 указанного дня», то есть граница
 * исключающая. Для одного дня Яндекс сам растягивает диапазон до суток («если
 * промежуток меньше суток, `toDate` = `fromDate` + сутки»), и ошибку не видно;
 * а вот «с 1 числа по сегодня» молча отрезало бы СЕГОДНЯШНИЕ заказы — ровно те,
 * ради которых продавец и открывает отчёт. Поэтому сдвиг делается всегда, а не
 * только для диапазонов: одно правило вместо двух, и оно закреплено тестом.
 */
export function creationDateParams(
  period: IReportPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  const bounds = periodBounds(period, now);
  return {
    from: calendarDateParam(bounds.from),
    to: calendarDateParam(shiftDays(bounds.to, 1)),
  };
}

/** Параметры Partner API для фильтра `updatedAt` (ISO 8601 со смещением). */
export function updatedAtParams(
  period: IReportPeriod,
  now: Date = new Date(),
): { from: string; to: string } {
  const bounds = periodBounds(period, now);
  return {
    from: calendarDayBounds(bounds.from, now).from,
    to: calendarDayBounds(bounds.to, now).to,
  };
}

/**
 * Проверка периода ДО отправки запроса — квота не тратится на то, что Яндекс
 * всё равно отклонит или вернёт пустым.
 *
 * Проверять нужно именно здесь: отчёты задают updatedAtFrom/supplierShipmentDate
 * напрямую через iterateOrders, минуя iterateOrdersInRange с его встроенной
 * проверкой. «С 1 числа» 31-го числа даёт ровно 30 дней и проходит; а вот
 * конкретный день месячной давности — нет.
 */
export function assertPeriodSupported(period: IReportPeriod, now: Date = new Date()): void {
  const bounds = periodBounds(period, now);
  const from = calendarDayStart(bounds.from, now);

  /**
   * Возраст меряем в КАЛЕНДАРНЫХ днях — от начала суток до начала суток.
   *
   * Считать от `now` нельзя: 31-го числа в 12:00 период «с 1 числа» отстоит от
   * текущего момента на 30.5 суток и был бы отвергнут, хотя в 09:00 того же дня
   * прошёл бы. Годность отчёта не может зависеть от того, который час.
   */
  const todayStart = calendarDayStart(moscowDay(now), now);

  const age = daysBetween(from, todayStart);
  if (age > HISTORY_WINDOW_DAYS) {
    throw new YandexDateRangeError(
      `Яндекс.Маркет отдаёт заказы не старше ${HISTORY_WINDOW_DAYS} дней. ` +
        `Выбранная дата — ${Math.floor(age)} дней назад.`,
    );
  }

  const to = calendarDayStart(bounds.to, now);
  if (from.getTime() > to.getTime()) {
    throw new YandexDateRangeError('Начало периода позже его конца.');
  }
}

// --- подписи -----------------------------------------------------------------

/** Короткая подпись для кнопки. */
export function periodButtonLabel(key: TPeriodKey): string {
  switch (key) {
    case PERIOD.DAY:
      return '🗓 Другой день';
    case PERIOD.WEEK:
      return '📆 С начала недели';
    case PERIOD.MONTH:
      return '🗓 С 1 числа месяца';
    default:
      return '📅 Сегодня';
  }
}

/** Подпись периода внутри кнопки рассылки — рядом со словом «Период:». */
export function periodShortLabel(key: TPeriodKey): string {
  switch (key) {
    case PERIOD.WEEK:
      return 'с начала недели';
    case PERIOD.MONTH:
      return 'с 1 числа месяца';
    default:
      return 'сегодня';
  }
}

/**
 * Сохранённый период рассылки, приведённый к допустимому.
 *
 * В базе лежит строка, и она может оказаться чем угодно: документ заведён до
 * появления поля, значение пришло из старой версии, кто-то правил руками.
 * Неизвестное значение — это «сегодня», а не падение отчёта.
 */
export function schedulePeriod(stored: string | undefined): TPeriodKey {
  return SCHEDULE_PERIODS.includes(stored as TPeriodKey) ? (stored as TPeriodKey) : PERIOD.TODAY;
}

/** Следующий период по кругу — кнопка перебирает их одним нажатием. */
export function nextSchedulePeriod(current: TPeriodKey): TPeriodKey {
  const index = SCHEDULE_PERIODS.indexOf(current);
  return SCHEDULE_PERIODS[(index + 1) % SCHEDULE_PERIODS.length];
}

/**
 * Подпись периода в заголовке отчёта.
 *
 * Для диапазона печатаются ОБЕ границы. «С начала недели» без дат заставляет
 * пересчитывать в уме, с какого числа считал бот, — а именно на эти числа
 * продавец потом смотрит в кабинете, сверяя цифры.
 */
export function periodTitle(period: IReportPeriod, now: Date = new Date()): string {
  const bounds = periodBounds(period, now);
  const from = calendarDateParam(bounds.from);
  const to = calendarDateParam(bounds.to);

  if (from === to) {
    return period.key === PERIOD.TODAY ? `за сегодня, ${from}` : `за ${from}`;
  }

  const prefix = period.key === PERIOD.WEEK ? 'с начала недели' : 'с начала месяца';
  return `${prefix}, ${from} — ${to}`;
}

// --- ввод конкретной даты ----------------------------------------------------

/**
 * Разбор даты, присланной пользователем.
 *
 * Принимаются оба разделителя: продавец пишет и «30-07-2026», и «30.07.2026»,
 * а бот сам печатает даты через дефис. Отвергать привычную точку значило бы
 * придираться к форме там, где смысл однозначен.
 */
export function parseDayInput(text: string): ICalendarDate | null {
  const match = text.trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Проверка существования даты: 31-02 разбирается по шаблону, но такого дня
  // нет — Date молча перенёс бы его на 3 марта, и отчёт пришёл бы не за тот
  // день, о котором просили.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;

  return { year, month, day };
}
