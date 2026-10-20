import type {
  PaymentsOptions,
  PaymentsOptionsResponse,
  PaymentsReport,
  PaymentsReportResponse,
} from '../payments.domain';

import { isoDayToRu } from '@/shared/report-file';

export function mapPaymentsOptions(response: PaymentsOptionsResponse): PaymentsOptions {
  return { periods: response.periods.map(({ key, label }) => ({ value: key, label })) };
}

export function mapPaymentsReport(response: PaymentsReportResponse): PaymentsReport {
  return {
    period: response.period,
    caption: `${isoDayToRu(response.dateFrom)} — ${isoDayToRu(response.dateTo)}`,
    emptyText: response.empty ? (response.emptyText ?? 'Данных за период нет.') : null,
    filename: response.filename,
  };
}
