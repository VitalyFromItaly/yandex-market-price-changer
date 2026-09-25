import type { TPaymentsPeriod } from '../../yandex/payments/payments.domain';
import type { IReportPeriod, TPeriodKey } from '../../yandex/reports/report-period';

import { PAYMENTS_PERIOD_LABELS } from '../../yandex/payments/payments.domain';
import { calendarDateParam } from '../../yandex/reports/moscow-day';
import { DEFAULT_PERIOD, PERIOD, parseDayInput } from '../../yandex/reports/report-period';

import { CrmJobError } from './crm-jobs.domain';

/**
 * Период отчёта в params фоновой задачи CRM — общий для всех kind-ов с
 * периодом (отчёты о заказах, прибыль, калькулятор). Чистый модуль.
 */

const PERIOD_KEYS = new Set<string>(Object.values(PERIOD));

const BAD_PERIOD = 'Не удалось разобрать период отчёта. Выберите его заново.';

/**
 * `{period: {key, day?: 'ДД-ММ-ГГГГ'}}` → период бота. Нет поля — период по
 * умолчанию; мусор — `CrmJobError`: текст для продавца, админов не будит.
 */
export function parsePeriodParams(params: Record<string, unknown>): IReportPeriod {
  const raw = params?.period;
  if (raw === undefined) return DEFAULT_PERIOD;
  if (typeof raw !== 'object' || raw === null) throw new CrmJobError(BAD_PERIOD);

  const { key: periodKey, day } = raw as { key?: unknown; day?: unknown };
  if (typeof periodKey !== 'string' || !PERIOD_KEYS.has(periodKey)) {
    throw new CrmJobError(BAD_PERIOD);
  }
  if (periodKey !== PERIOD.DAY) return { key: periodKey as TPeriodKey };

  const parsed = typeof day === 'string' ? parseDayInput(day) : null;
  if (!parsed) throw new CrmJobError('Нужна дата в формате ДД-ММ-ГГГГ, например 28-07-2026.');
  return { key: PERIOD.DAY, day: parsed };
}

export interface ICrmPeriodEcho {
  key: TPeriodKey;
  day: string | null;
}

/**
 * Эхо периода в ответе. Дедуп задач — по kind, и повторный POST с другим
 * периодом вернёт идущую задачу со СТАРЫМ периодом: фронт распознаёт чужой
 * результат по этому полю.
 */
export function periodEcho(period: IReportPeriod): ICrmPeriodEcho {
  return { key: period.key, day: period.day ? calendarDateParam(period.day) : null };
}

// --- пресеты платежей: «Платежи» и три отчёта Маркета с периодом ---------------

const BAD_PAYMENTS_PERIOD = 'Не удалось разобрать период отчёта. Выберите его заново.';

/**
 * Ключ пресета (`week` | `month` | `prevmonth`). Допустимые значения — ключи
 * `PAYMENTS_PERIOD_LABELS`, а не копия списка. Даты по ключу считает сервис в
 * момент выполнения (довод бота: «с 1 числа» на момент постановки и сборки
 * может отличаться), поэтому в params едет только ключ.
 */
export function parsePaymentsPeriod(raw: unknown): TPaymentsPeriod {
  if (typeof raw !== 'string' || !Object.hasOwn(PAYMENTS_PERIOD_LABELS, raw)) {
    throw new CrmJobError(BAD_PAYMENTS_PERIOD);
  }
  return raw as TPaymentsPeriod;
}

export interface ICrmOption<T extends string = string> {
  key: T;
  label: string;
}

/** Опции селектора периода — из той же таблицы, что кнопки бота. */
export function paymentsPeriodOptions(): ICrmOption<TPaymentsPeriod>[] {
  return (Object.keys(PAYMENTS_PERIOD_LABELS) as TPaymentsPeriod[]).map((key) => ({
    key,
    label: PAYMENTS_PERIOD_LABELS[key],
  }));
}
