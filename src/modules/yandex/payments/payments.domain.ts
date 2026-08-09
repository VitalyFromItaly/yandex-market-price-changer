import type { ICalendarDate } from '../reports/moscow-day';

import { moscowClock, moscowDay, shiftDays, startOfMonth } from '../reports/moscow-day';

/**
 * Отчёт по платежам (united-netting) — периоды, кодек кнопок и тексты.
 *
 * Чистый модуль: кодек читает и гейт возможностей (`features.domain.ts`).
 *
 * Ключа в `REPORT` у отчёта намеренно НЕТ (прецедент PLACED_DEFINITION):
 * `REPORT_DEFINITIONS` — таблица про статусы заказов, а `Object.values(REPORT)`
 * чеканит кнопки периодов и строку ежедневного дайджеста — xlsx-файл в
 * рассылке бессмыслен.
 */

/** Три пресета периода. Каждый ≤3 месяцев — лимита API не достигают. */
export type TPaymentsPeriod = 'week' | 'month' | 'prevmonth';

export const PAY_CB_PATTERN = /^pay:(week|month|prevmonth)$/;

export function payCallback(period: TPaymentsPeriod): string {
  return `pay:${period}`;
}

export function parsePayCallback(data: string | undefined): TPaymentsPeriod | null {
  const match = PAY_CB_PATTERN.exec(data ?? '');
  return match ? (match[1] as TPaymentsPeriod) : null;
}

export const PAYMENTS_PERIOD_LABELS: Record<TPaymentsPeriod, string> = {
  week: 'Последние 7 дней',
  month: 'С 1 числа месяца',
  prevmonth: 'Прошлый месяц',
};

/** Диапазон дат отчёта: `date` формата YYYY-MM-DD, обе границы включительно. */
export interface IPaymentsRange {
  dateFrom: string;
  dateTo: string;
}

/**
 * Границы периода по московскому календарю. Арифметика — календарная, через
 * moscow-day (мс-арифметика промахивается на границах месяца, довод
 * periodWindows).
 */
export function paymentsRange(period: TPaymentsPeriod, now: Date = new Date()): IPaymentsRange {
  const today = moscowDay(now);

  switch (period) {
    case 'week':
      return { dateFrom: isoDate(shiftDays(today, -6)), dateTo: isoDate(today) };
    case 'month':
      return { dateFrom: isoDate(startOfMonth(today)), dateTo: isoDate(today) };
    case 'prevmonth': {
      const lastOfPrev = shiftDays(startOfMonth(today), -1);
      return { dateFrom: isoDate(startOfMonth(lastOfPrev)), dateTo: isoDate(lastOfPrev) };
    }
  }
}

/** YYYY-MM-DD — формат dateFrom/dateTo этого отчёта (НЕ DD-MM-YYYY заказов). */
export function isoDate(date: ICalendarDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** DD-MM-YYYY для подписи и имени файла — как в остальных экранах. */
function ruDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

// --- тексты экрана ------------------------------------------------------------

export function paymentsAskPeriodText(): string {
  return '💳 Отчёт по платежам — за какой период?';
}

export function paymentsOrderedText(): string {
  return '⏳ Заказываю отчёт по платежам у Маркета, пришлю файлом, как будет готов…';
}

export function paymentsQueuedAlreadyText(): string {
  return '⏳ Отчёт по платежам уже собирается, подождите немного.';
}

export function paymentsErrorText(): string {
  return '❌ Не удалось собрать отчёт по платежам. Попробуйте позже.';
}

/** Отчёт сгенерирован, но данных за период нет (substatus NO_DATA). */
export function paymentsNoDataText(range: IPaymentsRange): string {
  return `💳 За период ${ruDate(range.dateFrom)} — ${ruDate(range.dateTo)} платежей нет.`;
}

/**
 * Подпись к файлу. Момент сборки обязателен: Telegram дедуплицирует документы
 * по содержимому и может показать старое имя файла — при расхождении верна
 * подпись (довод «Едет до клиента»).
 */
export function paymentsCaption(range: IPaymentsRange, now: Date = new Date()): string {
  return [
    `💳 Платежи ${ruDate(range.dateFrom)} — ${ruDate(range.dateTo)}`,
    `Собрано ${ruDate(isoDate(moscowDay(now)))} ${moscowClock(now)} МСК.`,
    'Это фактические перечисления Маркета — сверяйте с «💰 Прибыль».',
  ].join('\n');
}

export function paymentsFileName(range: IPaymentsRange, now: Date = new Date()): string {
  const time = moscowClock(now).replace(':', '');
  return `platezhi-${ruDate(range.dateFrom)}-${ruDate(range.dateTo)}-${time}.xlsx`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
