import type { ICalendarDate } from '../reports/moscow-day';

import { moscowClock, moscowDay, shiftDays, startOfMonth } from '../reports/moscow-day';

/**
 * Раздел «📈 Отчёты Маркета» — реестр шести отчётов, кодек кнопок и тексты.
 *
 * Чистый модуль: кодек читают кнопка, обработчик и гейт возможностей
 * (`features.domain.ts`). Один флаг `market_reports` на весь раздел — решение
 * продуктовое: шесть отдельных флагов раздули бы и меню, и панель.
 *
 * Параметры отчётов РАЗНОРОДНЫ (проверено по спеке): реализация хочет
 * год+месяц, конкурентная позиция — обязательную категорию, у ключевых
 * показателей дат нет вовсе. Поэтому вместо общего пикера периода — своя
 * короткая цепочка кнопок на отчёт; все шаги — inline (editMessageText,
 * паттерн schedule.handler), НЕ pendingRate: параметры дискретные.
 */

export type TMarketReportKey = 'real' | 'turn' | 'comp' | 'shows' | 'key' | 'geo';

export interface IMarketReportMeta {
  title: string;
  emoji: string;
  /** Оборачиваемость Маркет считает только для FBY-склада. */
  fbyOnly?: boolean;
  /** У comp и shows квота 10/час — на 420 отвечаем своим текстом. */
  hourlyLimit?: number;
}

/** Реестр раздела. Record — компилятор требует полноты по ключам. */
export const MARKET_REPORT_META: Readonly<Record<TMarketReportKey, IMarketReportMeta>> = {
  real: { title: 'Реализация (помесячно)', emoji: '🧾' },
  turn: { title: 'Оборачиваемость', emoji: '🔄', fbyOnly: true },
  comp: { title: 'Конкурентная позиция', emoji: '🥇', hourlyLimit: 10 },
  shows: { title: 'Аналитика продаж', emoji: '📊', hourlyLimit: 10 },
  key: { title: 'Ключевые показатели', emoji: '📌' },
  geo: { title: 'География продаж', emoji: '🗺' },
};

export const MARKET_REPORT_KEYS = Object.keys(MARKET_REPORT_META) as TMarketReportKey[];

// --- кодек callback_data ------------------------------------------------------
//
// Лимит Telegram — 64 байта. Самое длинное: `mkt:comp:<int64 categoryId>:prevmonth`
// ≈ 9 + 19 + 10 = 38 байт — влезает с запасом.

export const MKT_CB_PATTERN = /^mkt:(menu|real|turn|comp|shows|key|geo)(?::[A-Za-z0-9_-]+)*$/;

/** Возврат к списку отчётов. */
export const MKT_CB_MENU = 'mkt:menu';

export function mktCallback(key: TMarketReportKey, ...parts: Array<string | number>): string {
  return ['mkt', key, ...parts].join(':');
}

export interface IMktCallback {
  key: TMarketReportKey | 'menu';
  /** Хвост после ключа — параметры шага, разбирает обработчик отчёта. */
  args: string[];
}

export function parseMktCallback(data: string | undefined): IMktCallback | null {
  if (!MKT_CB_PATTERN.test(data ?? '')) return null;
  const [, key, ...args] = (data ?? '').split(':');
  return { key: key as IMktCallback['key'], args };
}

// --- параметры отчётов --------------------------------------------------------

/** Месяц отчёта по реализации. Кнопками — прошлый и позапрошлый. */
export interface IRealizationMonth {
  year: number;
  month: number;
  label: string;
}

const MONTH_TITLES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

/**
 * Два последних ЗАВЕРШЁННЫХ месяца по московскому календарю. Текущий не
 * предлагается: реализация — помесячный бухгалтерский отчёт, и незакрытый
 * месяц в нём бессмыслен.
 */
export function realizationMonths(now: Date = new Date()): IRealizationMonth[] {
  const lastOfPrev = shiftDays(startOfMonth(moscowDay(now)), -1);
  const lastOfPrevPrev = shiftDays(startOfMonth(lastOfPrev), -1);

  return [toRealizationMonth(lastOfPrev), toRealizationMonth(lastOfPrevPrev)];
}

function toRealizationMonth(date: ICalendarDate): IRealizationMonth {
  return {
    year: date.year,
    month: date.month,
    label: `${MONTH_TITLES[date.month - 1]} ${date.year}`,
  };
}

/** Группировка аналитики продаж — по спеке ShowsSalesGroupingType. */
export const SHOWS_GROUPINGS = [
  { code: 'CATEGORIES', short: 'cat', label: 'По категориям' },
  { code: 'OFFERS', short: 'off', label: 'По товарам' },
] as const;

/** Детализация ключевых показателей — по спеке KeyIndicators…LevelType. */
export const KEY_DETALIZATIONS = [
  { code: 'WEEK', short: 'week', label: 'По неделям' },
  { code: 'MONTH', short: 'month', label: 'По месяцам' },
] as const;

// --- тексты -------------------------------------------------------------------

export function mktMenuText(): string {
  return [
    '📈 Отчёты Маркета — какой собрать?',
    '',
    'Отчёт готовит сам Яндекс.Маркет, придёт xlsx-файлом через минуту-другую.',
  ].join('\n');
}

export function mktOrderedText(key: TMarketReportKey): string {
  const meta = MARKET_REPORT_META[key];
  return `⏳ Заказываю «${meta.title}» у Маркета, пришлю файлом, как будет готов…`;
}

export function mktQueuedAlreadyText(): string {
  return '⏳ Отчёт Маркета уже собирается, подождите немного.';
}

export function mktErrorText(key: TMarketReportKey): string {
  return `❌ Не удалось собрать «${MARKET_REPORT_META[key].title}». Попробуйте позже.`;
}

export function mktNoDataText(key: TMarketReportKey): string {
  return `${MARKET_REPORT_META[key].emoji} «${MARKET_REPORT_META[key].title}»: данных за выбранный период нет.`;
}

/** Честный ответ на 420 у отчётов с квотой 10/час. */
export function mktRateLimitText(key: TMarketReportKey): string {
  const limit = MARKET_REPORT_META[key].hourlyLimit ?? 10;
  return (
    `⚠️ Маркет ограничивает «${MARKET_REPORT_META[key].title}» ` +
    `${limit} запросами в час. Попробуйте позже.`
  );
}

export function mktTurnoverFbyOnlyText(): string {
  return '🔄 Оборачиваемость Маркет считает только для FBY-магазина.';
}

export function mktNoCategoriesText(): string {
  return '❌ Не удалось получить категории каталога. Попробуйте позже.';
}

/**
 * Подпись к файлу. Момент сборки обязателен: Telegram дедуплицирует документы
 * по содержимому и может показать старое имя файла — при расхождении верна
 * подпись (довод «Едет до клиента»).
 */
export function mktCaption(
  key: TMarketReportKey,
  paramsLine: string,
  now: Date = new Date(),
): string {
  const meta = MARKET_REPORT_META[key];
  const { year, month, day } = moscowDay(now);
  const lines = [
    `${meta.emoji} ${meta.title}`,
    paramsLine,
    `Собрано ${pad(day)}-${pad(month)}-${year} ${moscowClock(now)} МСК.`,
  ].filter(Boolean);
  return lines.join('\n');
}

export function mktFileName(key: TMarketReportKey, now: Date = new Date()): string {
  const { year, month, day } = moscowDay(now);
  const time = moscowClock(now).replace(':', '');
  return `otchet-${key}-${pad(day)}-${pad(month)}-${year}-${time}.xlsx`;
}

/** Человекочитаемый период для подписи. */
export function mktPeriodLine(range: { dateFrom: string; dateTo: string }): string {
  return `Период: ${ruDate(range.dateFrom)} — ${ruDate(range.dateTo)}`;
}

function ruDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
