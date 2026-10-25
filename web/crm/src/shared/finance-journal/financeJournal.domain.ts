import type { ReportPeriod } from '@/shared/period';

import { HISTORY_WINDOW_DAYS, PERIOD, dayToIso, monthLabel, shiftDay } from '@/shared/period';
import { formatSavedAt } from '@/shared/utils';

/**
 * Загружен ли финжурнал за период экрана и кнопка «Загрузить из Маркета».
 * Общее для всех экранов над журналом: «Обзор», «Финансы», unit-экономика,
 * аналитика продаж и возвратов, рейтинги. Нули на экране при незагруженном
 * журнале читались бы как «продаж не было».
 */

export type JournalMarketplace = 'ym' | 'ozon' | 'wb';

export const FINANCE_FEATURE = 'finance';
export const FINANCE_PULL_FEATURE = 'finance_pull';

/** Отчёт у Маркета генерируется минуты — чаще спрашивать незачем. */
export const PULL_POLL_MS = 5_000;
/** Дольше — перестаём ждать на экране; задача доделается сама. */
export const PULL_TIMEOUT_MS = 10 * 60_000;

/** Месяц из `GET /ym/finance/months` — только то, что нужно здесь. */
export interface JournalMonth {
  /** «ГГГГ-ММ». */
  month: string;
  /** В журнале есть версия отчёта (не путать со статусом: упавшая загрузка его тоже заводит). */
  loaded: boolean;
  /** Последняя попытка загрузки, и неудачная тоже; null — не грузили. */
  checkedAt: string | null;
  /** Почему упала последняя загрузка. */
  error: string | null;
}

/** Чей отчёт заказываем — «из Маркета», «у Ozon». */
export const JOURNAL_SOURCE_NAME: Record<JournalMarketplace, string> = {
  ym: 'Маркета',
  ozon: 'Ozon',
  wb: 'Wildberries',
};

export interface JournalPullResult {
  queued: string[];
  cooldown: { month: string; checkedAt: string; until: string }[];
}

export interface JournalCoverage {
  /** Месяцы периода без журнала — от свежего. */
  missing: string[];
  /** Месяцы периода, у которых последняя загрузка упала. */
  failed: { month: string; error: string }[];
  /** Последняя загрузка самого свежего загруженного месяца периода. */
  checkedAt: string | null;
}

/** Месяцы «ГГГГ-ММ», которые задевает период `ГГГГ-ММ-ДД … ГГГГ-ММ-ДД`, — от свежего. */
export function monthsOfRange(from: string, to: string): string[] {
  const index = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
  const months: string[] = [];
  for (let i = index(to); i >= index(from); i--) {
    months.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * Даты периода отчёта бота («Сегодня», «С начала недели», …) — чтобы спросить
 * журнал за них. `today` — «ГГГГ-ММ-ДД» по Москве; «Всего» — окно заказов (30 дней).
 */
export function rangeOfReportPeriod(
  period: ReportPeriod,
  today: string,
): { from: string; to: string } {
  switch (period.key) {
    case PERIOD.DAY: {
      const day = dayToIso(period.day) || today;
      return { from: day, to: day };
    }
    case PERIOD.WEEK: {
      const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: shiftDay(today, -weekday), to: today };
    }
    case PERIOD.MONTH:
      return { from: `${today.slice(0, 8)}01`, to: today };
    case PERIOD.PREV_MONTH: {
      const lastOfPrev = shiftDay(`${today.slice(0, 8)}01`, -1);
      return { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev };
    }
    case PERIOD.ALL:
      return { from: shiftDay(today, -HISTORY_WINDOW_DAYS), to: today };
    default:
      return { from: today, to: today };
  }
}

/**
 * Что известно о журнале периода. Месяц старше списка (тринадцать месяцев) не
 * судим: ни загрузить его, ни сказать о нём нечего.
 */
export function coverageOf(
  months: readonly JournalMonth[],
  wanted: readonly string[],
): JournalCoverage {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const known = wanted.flatMap((month) => byMonth.get(month) ?? []);
  return {
    missing: known.filter((m) => !m.loaded).map((m) => m.month),
    failed: known.flatMap((m) => (m.error === null ? [] : [{ month: m.month, error: m.error }])),
    checkedAt: known.find((m) => m.loaded)?.checkedAt ?? null,
  };
}

/**
 * Что обновлять кнопкой «Обновить» у загруженного периода: только текущий и
 * прошлый месяц — их Маркет ещё дописывает. Закрытые старше меняются редко, а
 * каждый месяц — генерация отчёта из общей квоты 100 в час.
 */
export function refreshableOf(wanted: readonly string[], recent: readonly string[]): string[] {
  const open = new Set(recent.slice(0, 2));
  return wanted.filter((month) => open.has(month));
}

/** Все поставленные месяцы загрузились (или упали): их `checkedAt` сменился. */
export function pullDone(
  before: Readonly<Record<string, string | null>>,
  months: readonly JournalMonth[],
): boolean {
  const byMonth = new Map(months.map((m) => [m.month, m.checkedAt]));
  return Object.entries(before).every(([month, checkedAt]) => {
    const now = byMonth.get(month) ?? null;
    return now !== null && now !== checkedAt;
  });
}

const monthsText = (months: readonly string[]) =>
  months
    .slice()
    .reverse()
    .map((month) => monthLabel(month).toLowerCase())
    .join(', ');

/** «Журнал за октябрь 2026 не загружен» / «Журнал за сентябрь 2026, октябрь 2026 не загружен». */
export function missingTitle(missing: readonly string[]): string {
  return `Журнал за ${monthsText(missing)} не загружен — считать не из чего`;
}

/** Подпись загруженного журнала: «Журнал обновлён в 04:12» / «… 19-10-2026 04:12». */
export function checkedAtText(checkedAt: string, now: Date = new Date()): string {
  const at = formatSavedAt(checkedAt, now);
  return at === null ? 'Журнал загружен' : `Журнал обновлён ${at.includes('-') ? '' : 'в '}${at}`;
}

/** Месяцы, которые грузили меньше 15 минут назад, — когда можно снова. */
export function cooldownText(
  cooldown: JournalPullResult['cooldown'],
  now: Date = new Date(),
): string {
  const until = cooldown.map((c) => c.until).sort()[cooldown.length - 1];
  const at = until === undefined ? null : formatSavedAt(until, now);
  const what = cooldown.length === 1 ? 'Этот месяц' : 'Эти месяцы';
  return `${what} уже загружали только что — повторить можно ${at === null ? 'через 15 минут' : `после ${at}`}.`;
}

/** Причина упавшей загрузки — одной строкой на месяц. */
export function failedText(failed: JournalCoverage['failed']): string {
  return failed
    .map((f) => `${monthLabel(f.month)}: последняя загрузка не удалась — ${f.error}`)
    .join('; ');
}
