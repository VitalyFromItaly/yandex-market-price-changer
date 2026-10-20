import type { FinanceOperation, OperationRow } from './financeOperations.domain';

import { formatKopecks, formatMoscowDate } from '@/shared/utils';

/**
 * Строка журнала → строка таблицы раскрытия. Пустые поля — null, не «—» в данных.
 *
 * У расшифрованной строки (сводная строка акта) при раскрытии статьи сумма —
 * доля этой статьи, а вся сумма строки — подписью «из …»: иначе Σ таблицы не
 * сошлась бы с итогом статьи. Вместо пустого названия услуги — из чего строка.
 */
export function toOperationRow(op: FinanceOperation, article?: string): OperationRow {
  const kind = [op.transactionType, op.transactionSource]
    .filter((part) => part !== null)
    .join(' · ');
  let sku = op.sku;
  if (sku !== null && op.count !== null) sku = `${sku} × ${op.count}`;
  const parts = op.parts ?? null;
  const part = article !== undefined ? parts?.find((p) => p.article === article) : undefined;
  const kopecks = part ? part.kopecks : op.amountKopecks;
  let service = op.serviceName;
  if (service === null && parts !== null) {
    service = `Расшифровка: ${parts.map((p) => `${p.articleTitle} ${formatKopecks(p.kopecks)}`).join(', ')}`;
  }
  return {
    id: op.id,
    day: formatMoscowDate(op.accruedAt) ?? op.accruedAt,
    kind: kind || op.articleTitle,
    service,
    order: op.orderId,
    sku,
    amount: formatKopecks(kopecks),
    negative: kopecks < 0,
    partOf: part ? `из ${formatKopecks(op.amountKopecks)}` : null,
    documentId: op.documentId,
  };
}
