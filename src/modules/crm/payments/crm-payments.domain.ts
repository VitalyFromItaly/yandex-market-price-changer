import type { TPaymentsPeriod } from '../../yandex/payments/payments.domain';
import type { ICrmOption } from '../jobs/crm-period.domain';

import { paymentsNoDataText, paymentsRange } from '../../yandex/payments/payments.domain';
import { withoutIcon } from '../jobs/crm-jobs.domain';
import { parsePaymentsPeriod, paymentsPeriodOptions } from '../jobs/crm-period.domain';

/**
 * «Платежи» в CRM — чистая часть: разбор params, вид ответа и опции формы.
 * Отчёт — xlsx Маркета как есть (united-netting), своих чисел здесь нет.
 */

/** Один kind на все периоды: замок дедупа — «один отчёт по платежам за раз». */
export const PAYMENTS_JOB_KIND = 'payments:report';

export function parsePaymentsParams(params: Record<string, unknown>): TPaymentsPeriod {
  return parsePaymentsPeriod(params?.period);
}

export interface ICrmPaymentsView {
  /** Эхо периода: дедуп по kind вернёт идущую задачу со СТАРЫМ периодом. */
  period: TPaymentsPeriod;
  /** Границы, посчитанные в момент сборки (YYYY-MM-DD). */
  dateFrom: string;
  dateTo: string;
  /** Маркет собрал отчёт, но данных за период нет (NO_DATA) — не ошибка. */
  empty: boolean;
  emptyText: string | null;
  filename: string | null;
}

export function toCrmPaymentsView(
  period: TPaymentsPeriod,
  now: Date,
  filename: string | null,
): ICrmPaymentsView {
  const range = paymentsRange(period, now);
  return {
    period,
    ...range,
    empty: filename === null,
    emptyText: filename === null ? withoutIcon(paymentsNoDataText(range)) : null,
    filename,
  };
}

export interface ICrmPaymentsOptions {
  periods: ICrmOption<TPaymentsPeriod>[];
}

export function paymentsOptions(): ICrmPaymentsOptions {
  return { periods: paymentsPeriodOptions() };
}
