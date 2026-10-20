import type { IFinancePeriod } from './finance-period';
import type { IUnconfirmedProfit } from '../../shared/profit-confirmation';
import type { IReportPeriod } from '../yandex/reports/report-period';

import { isoDate } from '../yandex/payments/payments.domain';
import { isUnbounded, periodBounds } from '../yandex/reports/report-period';

/**
 * «Фактическая чистая» рядом с плоской в «💰 Прибыли» (TASK-126, решение
 * `finance_actual_beside_flat`). Лист без Nest и базы: период бота → период
 * журнала, форма результата и тексты, общие боту и CRM.
 *
 * Тексты — без разметки (прецедент `PROFIT_EMPTY_TEXT`): HTML накладывает только
 * форматтер бота, CRM печатает их как есть. Две копии одной формулировки
 * расходятся молча.
 */

export type IProfitActual =
  | {
      /** Все месяцы периода проверены — число из P&L журнала. */
      state: 'verified';
      netKopecks: number;
      unconfirmed: IUnconfirmedProfit;
      from: string;
      to: string;
    }
  | {
      /** Журнал периода не проверен (или его нет) — плоская помечается. */
      state: 'preliminary';
      reason: string;
    }
  | {
      /** Журнал прочитать не удалось — плоская помечается, причина своя. */
      state: 'unavailable';
      reason: string;
    };

export const ACTUAL_NET_LABEL = 'Фактическая чистая';

/**
 * Журнал бизнесовый (колонки кампании в нём нет), а плоская — по открытому
 * магазину. Без оговорки продавец с двумя магазинами сравнил бы несравнимое.
 */
export const ACTUAL_SCOPE_NOTE = 'по проверенному журналу Маркета, весь кабинет';

/** Пометка плоской чистой, пока журнал периода не проверен. */
export const PRELIMINARY_MARK = 'предварительно';

export const ACTUAL_ALL_REASON =
  'за «Всего» журнала нет — фактическая чистая считается за календарные периоды';
export const ACTUAL_UNAVAILABLE_REASON =
  'фактическую чистую получить не удалось: журнал недоступен';

/**
 * Почему период не проверен — словами статуса. «Проверено» бывает только у
 * закрытого и сверенного месяца, поэтому текущий месяц всегда здесь.
 */
export function preliminaryReason(statusLabel: string): string {
  return `журнал Маркета за период — «${statusLabel}», фактическая чистая появится после сверки закрытого месяца`;
}

/**
 * Период бота → период журнала. «Всего» — не период, а его отсутствие: журнала
 * «за всё время» нет, отсюда null.
 */
export function financePeriodOf(period: IReportPeriod, now: Date): IFinancePeriod | null {
  if (isUnbounded(period)) return null;
  const bounds = periodBounds(period, now);
  return { from: isoDate(bounds.from), to: isoDate(bounds.to) };
}
