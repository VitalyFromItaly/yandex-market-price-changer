/**
 * Период финансового отчёта. Чистые функции — без Nest и базы.
 *
 * Границы — календарные дни «ГГГГ-ММ-ДД» по Москве, как их принимает Маркет
 * (`dateFrom`/`dateTo` united-netting) и как их хранит FinanceDocument.
 */

import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

import { moscowDay } from '../yandex/reports/moscow-day';

export interface IFinancePeriod {
  /** ГГГГ-ММ-ДД. */
  from: string;
  /** ГГГГ-ММ-ДД, включительно. */
  to: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Сегодня по Москве, «ГГГГ-ММ-ДД» — граница «закрыт ли период» и конец запроса. */
export function financeToday(now: Date = new Date()): string {
  const { year, month, day } = moscowDay(now);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Календарный месяц (month — 1…12). */
export function monthPeriod(year: number, month: number): IFinancePeriod {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Месяц указан неверно: ${month}.${year}`);
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad2(month)}-01`, to: `${year}-${pad2(month)}-${pad2(last)}` };
}

/** «ММ-ГГГГ» → месяц. Мусор → null. */
export function parseMonthArg(value: string): IFinancePeriod | null {
  const m = /^(\d{2})-(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  return monthPeriod(Number(m[2]), month);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Период пригоден для отчёта: обе даты «ГГГГ-ММ-ДД» и не задом наперёд. */
export function assertFinancePeriod(period: IFinancePeriod): void {
  if (!ISO_DAY.test(period.from) || !ISO_DAY.test(period.to)) {
    throw new Error(`Период ожидается датами ГГГГ-ММ-ДД: ${period.from}…${period.to}`);
  }
  if (period.from > period.to) {
    throw new Error(`Начало периода позже конца: ${period.from}…${period.to}`);
  }
}

/** Потолок произвольного периода: год с запасом на високосный. Длиннее — оригиналы журнала не помогут. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Настоящая календарная дата «ГГГГ-ММ-ДД» (2026-02-31 — нет); иначе null. */
function dayMs(value: unknown): number | null {
  const m = typeof value === 'string' ? ISO_DAY_PARTS.exec(value) : null;
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

/**
 * Произвольный период снаружи — из браузера (TASK-125, решение `finance_pnl_range`)
 * или из аргументов инструмента ИИ (TASK-147): обе даты настоящие, не задом
 * наперёд, не длиннее `MAX_RANGE_DAYS`. Мусор — null: `assertFinancePeriod`
 * проверяет только форму, а 2026-02-31 он пропустил бы.
 */
export function parseDayRange(from: unknown, to: unknown): IFinancePeriod | null {
  const a = dayMs(from);
  const b = dayMs(to);
  if (a === null || b === null || a > b) return null;
  if ((b - a) / DAY_MS + 1 > MAX_RANGE_DAYS) return null;
  return { from: from as string, to: to as string };
}

/** Тип отчёта в FinanceDocument и ключе периода. */
export const YM_NETTING_REPORT_TYPE = 'united-netting';

/**
 * Тип «отчёта» Ozon — список операций /v3/finance/transaction/list (TASK-131).
 * Свой, а не общий с ЯМ: ключ периода несёт тип, и у площадок он не совпадёт.
 */
export const OZON_TRANSACTIONS_REPORT_TYPE = 'ozon-transaction-list';

/** Тип «отчёта» WB — отчёт реализации reportDetailByPeriod (TASK-136). */
export const WB_REALIZATION_REPORT_TYPE = 'wb-realization-report';

/** Тип журнала площадки — ключ периода, версии документа и статуса месяца. */
export const FINANCE_REPORT_TYPE: Record<TFinanceMarketplace, string> = {
  ym: YM_NETTING_REPORT_TYPE,
  ozon: OZON_TRANSACTIONS_REPORT_TYPE,
  wb: WB_REALIZATION_REPORT_TYPE,
};

/**
 * Ключ периода у операций и корректировок: тип отчёта + границы. Одна строка,
 * а не три поля — по ней ищутся строки, снятые новой версией документа.
 */
export function financePeriodKey(reportType: string, period: IFinancePeriod): string {
  return `${reportType}:${period.from}:${period.to}`;
}

/**
 * Границы запроса к Маркету: конец незакрытого периода — сегодня. Период
 * (ключ, версия документа) остаётся календарным месяцем: иначе каждая ночь
 * заводила бы новый период «с 1-го по вчера», и замена версии — ради которой
 * журнал в Postgres — не срабатывала бы никогда. Дат из будущего Маркету не шлём.
 */
export function requestRange(period: IFinancePeriod, today: string): IFinancePeriod {
  return { from: period.from, to: period.to > today ? today : period.to };
}

/** Месяц, сдвинутый на `shift` (−1 — прошлый). */
function monthShifted(year: number, month: number, shift: number): IFinancePeriod {
  const index = year * 12 + (month - 1) + shift;
  return monthPeriod(Math.floor(index / 12), (index % 12) + 1);
}

/**
 * Что грузить в ночной проход (TASK-112), `today` — «ГГГГ-ММ-ДД» по Москве.
 *
 * Каждую ночь — текущий месяц и прошлый: журнал текущего прирастает, а
 * прошлый Маркет дописывает актами и выплатами ещё недели после закрытия.
 * По понедельникам — ещё позапрошлый («повторная сверка раз в неделю за
 * прошлые 2 месяца», ТЗ п.4). Порядок — от текущего к старшему (TASK-113):
 * сверка закрытого месяца ищет начисления и выплаты и в отчёте следующего, и
 * он должен быть загружен этой же ночью ДО неё. Кончится квота посреди
 * прохода — пострадает старший месяц, то есть еженедельная повторная сверка.
 */
export function scheduledPeriods(today: string): IFinancePeriod[] {
  if (!ISO_DAY.test(today)) throw new Error(`Дата ожидается ГГГГ-ММ-ДД: ${today}`);
  const [year, month, day] = today.split('-').map(Number);
  const monday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;

  const shifts = monday ? [0, -1, -2] : [0, -1];
  return shifts.map((shift) => monthShifted(year, month, shift));
}

/** Календарные месяцы, которые задевает период, — от первого к последнему. */
export function monthsOf(period: IFinancePeriod): IFinancePeriod[] {
  assertFinancePeriod(period);
  const [fromYear, fromMonth] = period.from.split('-').map(Number);
  const [toYear, toMonth] = period.to.split('-').map(Number);
  const months: IFinancePeriod[] = [];
  for (let index = fromYear * 12 + fromMonth - 1; index <= toYear * 12 + toMonth - 1; index += 1) {
    months.push(monthPeriod(Math.floor(index / 12), (index % 12) + 1));
  }
  return months;
}

/** День «ГГГГ-ММ-ДД», сдвинутый на `days` (−1 — вчера). Календарная арифметика в UTC, без часовых поясов. */
export function shiftDay(day: string, days: number): string {
  const m = ISO_DAY_PARTS.exec(day);
  if (!m) throw new Error(`Дата ожидается ГГГГ-ММ-ДД: ${day}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
    .toISOString()
    .slice(0, 10);
}
