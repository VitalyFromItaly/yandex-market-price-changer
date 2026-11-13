/**
 * Журнал синхронизации финансов и правила надёжной загрузки «Финучёта»
 * (TASK-212, ТЗ п.11). Чистые функции — без Nest, базы и Redis.
 *
 * `finance_periods` хранит ПОСЛЕДНЕЕ состояние периода (каждая попытка
 * перезаписывает строку) — истории попыток и времени последнего УСПЕХА там нет.
 * Их держит `finance_sync_runs`: одна строка на попытку загрузки периода.
 */

import type { IFinancePeriod } from './finance-period';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

import { FINANCE_REPORT_TYPE, financePeriodKey, monthPeriod } from './finance-period';

/** Что запустило попытку. */
export const FINANCE_SYNC_TRIGGERS = ['nightly', 'frequent', 'manual', 'retry', 'missed'] as const;
export type TFinanceSyncTrigger = (typeof FINANCE_SYNC_TRIGGERS)[number];

export const FINANCE_SYNC_TRIGGER_LABEL: Record<TFinanceSyncTrigger, string> = {
  nightly: 'Ежедневная полная',
  frequent: 'Текущий период',
  manual: 'По кнопке',
  retry: 'Повтор после сбоя',
  missed: 'Пропущенный период',
};

/** Исход попытки: исходы импорта плюс сбой и «площадка отключена». */
export type TFinanceSyncOutcome = 'empty' | 'unchanged' | 'imported' | 'failed' | 'not-connected';

/** Успех — данные периода получены (в том числе «пусто» и «не изменилось»). */
export function isSyncSuccess(outcome: TFinanceSyncOutcome): boolean {
  return outcome === 'empty' || outcome === 'unchanged' || outcome === 'imported';
}

/** Длина текста ошибки в журнале: стек и тело ответа площадки сюда не кладутся. */
export const SYNC_ERROR_MAX_LENGTH = 500;

export function syncErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > SYNC_ERROR_MAX_LENGTH
    ? `${text.slice(0, SYNC_ERROR_MAX_LENGTH - 1)}…`
    : text;
}

/** Сколько хранить журнал попыток: дольше окна перезагрузки и с запасом на разбор. */
export const SYNC_RUNS_RETENTION_DAYS = 90;

/**
 * Окно перезагрузки «Финучёта» (`FIN_ACCOUNTING_RELOAD_MONTHS`): текущий месяц и
 * `months − 1` прошлых, от текущего к старшему — тот же порядок, что у
 * `scheduledPeriods` (сверка закрытого месяца ищет хвосты в следующем). ЯМ
 * дописывает месяц актами и выплатами ещё недели после закрытия, Ozon —
 * начисления задним числом: отчёт, появившийся с задержкой, забирает
 * следующая ночь, пока месяц в окне.
 */
export function reloadWindow(today: string, months: number): IFinancePeriod[] {
  const [year, month] = today.split('-').map(Number);
  const result: IFinancePeriod[] = [];
  for (let shift = 0; shift < Math.max(1, months); shift += 1) {
    const index = year * 12 + (month - 1) - shift;
    result.push(monthPeriod(Math.floor(index / 12), (index % 12) + 1));
  }
  return result;
}

/** Объединение списков периодов без повторов, от нового к старому. */
export function mergePeriods(...lists: readonly (readonly IFinancePeriod[])[]): IFinancePeriod[] {
  const byFrom = new Map<string, IFinancePeriod>();
  for (const list of lists) for (const period of list) byFrom.set(period.from, period);
  return [...byFrom.values()].sort((a, b) => b.from.localeCompare(a.from));
}

/** База отложенного повтора; n-й повтор — через base·2^(n−1): 10, 20, 40 мин. */
export const SYNC_RETRY_BASE_MS = 10 * 60_000;

/**
 * Задержка повтора номер `retry` (1, 2, …). Повтор — отложенная разовая задача
 * в той же очереди, а не `attempts` Bull: у очереди attempts 1 нарочно (квота
 * генераций ЯМ), и сон внутри задачи держал бы concurrency 1 всей очереди.
 */
export function syncRetryDelayMs(retry: number): number {
  return SYNC_RETRY_BASE_MS * 2 ** Math.max(0, retry - 1);
}

/** Последнее состояние периода по журналу попыток. */
export interface IFinanceSyncPeriodState {
  marketplace: TFinanceMarketplace;
  periodKey: string;
  from: string;
  to: string;
  lastAttemptAt: Date;
  lastOutcome: TFinanceSyncOutcome;
  lastTrigger: TFinanceSyncTrigger;
  /** Номер попытки последней записи: 1 — первая, дальше — повторы. */
  lastAttempt: number;
  lastError: string | null;
  /** Последний УСПЕХ — отдельно от последней попытки; null — успеха не было. */
  lastSuccessAt: Date | null;
}

/** Период окна площадки и его состояние (null — попыток не было вовсе). */
export interface IFinanceSyncWindowRow {
  marketplace: TFinanceMarketplace;
  period: IFinancePeriod;
  periodKey: string;
  state: IFinanceSyncPeriodState | null;
  /** Пропущен: в окне, а успешной загрузки нет. */
  missed: boolean;
}

/** Окно по площадкам с состоянием каждого периода — экран «Финучёта» и контроль пропусков. */
export function syncWindowRows(
  marketplaces: readonly TFinanceMarketplace[],
  window: readonly IFinancePeriod[],
  states: readonly IFinanceSyncPeriodState[],
): IFinanceSyncWindowRow[] {
  const byKey = new Map(states.map((state) => [`${state.marketplace}|${state.periodKey}`, state]));
  const rows: IFinanceSyncWindowRow[] = [];
  for (const marketplace of marketplaces) {
    for (const period of window) {
      const periodKey = financePeriodKey(FINANCE_REPORT_TYPE[marketplace], period);
      const state = byKey.get(`${marketplace}|${periodKey}`) ?? null;
      rows.push({ marketplace, period, periodKey, state, missed: !state?.lastSuccessAt });
    }
  }
  return rows;
}

/**
 * Пропущенные периоды, которые пора поставить в очередь: успеха не было, а
 * последняя попытка (если была) старше `cooldownMs` — сбой через минуту не
 * лечится, а квоту жжёт. Площадка, которую отключили, не пропуск.
 */
export function missedToQueue(
  rows: readonly IFinanceSyncWindowRow[],
  now: Date,
  cooldownMs: number,
): IFinanceSyncWindowRow[] {
  return rows.filter((row) => {
    if (!row.missed) return false;
    if (!row.state) return true;
    if (row.state.lastOutcome === 'not-connected') return false;
    return now.getTime() - row.state.lastAttemptAt.getTime() >= cooldownMs;
  });
}

/**
 * Сбой, о котором пора сказать продавцу: последняя попытка — сбой, и повторов
 * больше не будет. Первая попытка — номер 1 (любой запуск), повторы — 2…
 * `maxRetries + 1`; сбой не последнего номера ещё повторится сам. Успех после
 * сбоя гасит — его последняя попытка уже не сбой.
 */
export function isSyncFailureFinal(state: IFinanceSyncPeriodState, maxRetries: number): boolean {
  if (state.lastOutcome !== 'failed') return false;
  return state.lastAttempt > maxRetries;
}

/** «ГГГГ-ММ» периода — для id задач без двоеточий. */
export const periodMonth = (period: IFinancePeriod) => period.from.slice(0, 7);
