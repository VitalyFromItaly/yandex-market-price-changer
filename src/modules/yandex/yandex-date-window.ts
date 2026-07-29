import { HISTORY_WINDOW_DAYS } from './yandex-api.paths';
import { YandexApiError } from './yandex-api.errors';

/**
 * Окно истории Partner API.
 *
 * `getOrders` не отдаёт данные старше 30 дней, и каждый запрошенный диапазон
 * тоже ограничен 30 днями. Это две РАЗНЫЕ границы, и вторая без первой
 * бесполезна: разбить 45 дней на два окна можно, но во второе окно Яндекс
 * всё равно вернёт пустоту — получился бы молча неполный отчёт, а это хуже
 * явной ошибки. Поэтому слишком широкий или слишком старый диапазон
 * отклоняется с внятным текстом, а не «чинится» втихую.
 *
 * Для истории глубже 30 дней есть POST v1/businesses/{businessId}/orders —
 * отдельный метод, ради которого и хранится business_id.
 */

const MS_IN_DAY = 24 * 60 * 60 * 1000;

/** Ошибка НАША, не Яндекса: запрос отклонён до отправки. */
export class YandexDateRangeError extends YandexApiError {
  constructor(message: string) {
    super(message, 0);
  }

  public get userMessage(): string {
    return this.message;
  }
}

export interface IDateRange {
  from: Date;
  to: Date;
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_IN_DAY;
}

/**
 * Проверка диапазона перед отправкой. Бросает YandexDateRangeError — до сети
 * дело не доходит, квота не тратится.
 */
export function assertWithinHistoryWindow(range: IDateRange, now: Date): void {
  if (!(range.from instanceof Date) || Number.isNaN(range.from.getTime())) {
    throw new YandexDateRangeError('Некорректная дата начала периода.');
  }
  if (!(range.to instanceof Date) || Number.isNaN(range.to.getTime())) {
    throw new YandexDateRangeError('Некорректная дата конца периода.');
  }
  if (range.from.getTime() > range.to.getTime()) {
    throw new YandexDateRangeError('Начало периода позже его конца.');
  }

  const span = daysBetween(range.from, range.to);
  if (span > HISTORY_WINDOW_DAYS) {
    throw new YandexDateRangeError(
      `Период не может быть длиннее ${HISTORY_WINDOW_DAYS} дней — столько хранит Яндекс.Маркет. ` +
        `Запрошено ${Math.ceil(span)}.`,
    );
  }

  const age = daysBetween(range.from, now);
  if (age > HISTORY_WINDOW_DAYS) {
    throw new YandexDateRangeError(
      `Яндекс.Маркет отдаёт заказы не старше ${HISTORY_WINDOW_DAYS} дней. ` +
        `Начало периода — ${Math.floor(age)} дней назад.`,
    );
  }
}

/**
 * Разбиение диапазона на окна по 30 дней. Для getOrders не применяется (см.
 * выше), но нужно для истории по businesses, где ограничение на ДЛИНУ
 * диапазона есть, а на глубину — нет.
 */
export function splitIntoWindows(
  range: IDateRange,
  windowDays = HISTORY_WINDOW_DAYS,
): IDateRange[] {
  const windows: IDateRange[] = [];
  let cursor = range.from;

  while (cursor.getTime() < range.to.getTime()) {
    const next = new Date(cursor.getTime() + windowDays * MS_IN_DAY);
    const to = next.getTime() < range.to.getTime() ? next : range.to;
    windows.push({ from: cursor, to });
    cursor = to;
  }

  // Диапазон нулевой длины — одно окно, а не пустой список: вызывающий код
  // рассчитывает хотя бы на один запрос.
  return windows.length ? windows : [{ from: range.from, to: range.to }];
}

/** Формат fromDate/toDate у Partner API — DD-MM-YYYY, а не ISO. */
export function toDateParam(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getUTCFullYear()}`;
}
