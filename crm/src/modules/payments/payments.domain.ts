/**
 * «Платежи» — отчёт united-netting, xlsx Маркета как есть. Зеркало ответов
 * `GET /ym/payments/options` и фоновой задачи `payments:report`
 * (src/modules/crm/payments/crm-payments.domain.ts). Даты периода считает
 * сервер в момент сборки — фронт шлёт только ключ пресета.
 */

export const PAYMENTS_JOB_KIND = 'payments:report';

/** Ключ пресета периода — варианты приходят с сервера (PAYMENTS_PERIOD_LABELS бота). */
export type PaymentsPeriod = string;

export interface Option<T extends string | number = string> {
  value: T;
  label: string;
}

export interface PaymentsOptionsResponse {
  periods: { key: string; label: string }[];
}

export interface PaymentsOptions {
  periods: Option[];
}

export interface PaymentsReportResponse {
  period: string;
  dateFrom: string;
  dateTo: string;
  empty: boolean;
  emptyText: string | null;
  filename: string | null;
}

export interface PaymentsReport {
  period: string;
  /** «01-07-2026 — 31-07-2026» — границы, посчитанные в момент сборки. */
  caption: string;
  emptyText: string | null;
  filename: string | null;
}
