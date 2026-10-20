import type {
  AnomaliesModel,
  AnomalyRow,
  FinanceAnomalies,
  FinanceAnomaly,
} from '../finance.domain';

import { formatCount, formatKopecks, formatMoscowDate, plural } from '@/shared/utils';

export function toAnomalyRow(item: FinanceAnomaly): AnomalyRow {
  const parts = [
    item.sku ? `Товар ${item.sku}` : null,
    item.orderId ? `заказ ${item.orderId}` : null,
  ];
  const reference = parts.filter((part) => part !== null).join(' · ');
  const n = item.operationCount;
  return {
    key: item.key,
    label: item.kindLabel,
    detail: item.detail,
    threshold: item.threshold,
    reference: reference || null,
    amount: item.amountKopecks === null ? null : formatKopecks(item.amountKopecks),
    operations: `${formatCount(n)} ${plural(n, ['операция', 'операции', 'операций'])}`,
    operationIds: [...item.operationIds],
    reviewed: item.reviewed,
  };
}

export function toAnomaliesModel(page: FinanceAnomalies): AnomaliesModel {
  const day = page.checkedAt ? formatMoscowDate(page.checkedAt) : null;
  return {
    rows: page.items.map(toAnomalyRow),
    total: page.total,
    unreviewed: page.unreviewed,
    checkedLabel: day ? `Проверено ${day}` : null,
  };
}
