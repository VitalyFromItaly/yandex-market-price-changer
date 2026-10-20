import type {
  CorrectionRow,
  DiscrepancyRow,
  FinanceCorrection,
  FinanceCorrectionSide,
  FinanceDiscrepancy,
} from '../finance.domain';

import { formatCount, formatKopecks, formatMoscowDate, plural } from '@/shared/utils';

const money = (kopecks: number | null): string | null =>
  kopecks === null ? null : formatKopecks(kopecks);

export function toDiscrepancyRow(item: FinanceDiscrepancy, index: number): DiscrepancyRow {
  let reference: string | null = null;
  if (item.orderId !== null) reference = `Заказ ${item.orderId}`;
  else if (item.bankOrderId !== null) reference = `Поручение № ${item.bankOrderId}`;
  const n = item.operationCount;
  return {
    key: `${item.kind}-${item.orderId ?? item.bankOrderId ?? ''}-${index}`,
    label: item.kindLabel,
    reference,
    detail: item.detail,
    expected: money(item.expectedKopecks),
    actual: money(item.actualKopecks),
    operations: `${formatCount(n)} ${plural(n, ['операция', 'операции', 'операций'])}`,
  };
}

function whatOf(side: FinanceCorrectionSide): string {
  const parts = [
    side.articleTitle,
    side.serviceName,
    side.orderId ? `заказ ${side.orderId}` : null,
  ];
  const day = formatMoscowDate(side.accruedAt);
  return [...parts, day].filter((part) => part !== null && part !== '').join(' · ');
}

export function toCorrectionRow(item: FinanceCorrection, index: number): CorrectionRow {
  return {
    key: `${item.documentVersion}-${item.createdAt}-${index}`,
    kindLabel: item.kind === 'changed' ? 'Изменена' : 'Убрана',
    what: whatOf(item.before),
    before: formatKopecks(item.before.amountKopecks),
    after: item.after === null ? null : formatKopecks(item.after.amountKopecks),
    version: `версия ${item.documentVersion}`,
  };
}
