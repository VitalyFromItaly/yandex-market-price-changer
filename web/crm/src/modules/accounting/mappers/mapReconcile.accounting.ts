import type {
  AccountingMarketplace,
  ReconcileActResponse,
  ReconcileCandidate,
  ReconcileCandidateReason,
  ReconcileCandidateRow,
  ReconcileDocumentRow,
  ReconcileLineKey,
  ReconcileLineResponse,
  ReconcileLineRow,
  ReconcileLineStatus,
  ReconcilePaymentOrderResponse,
  ReconcileResponse,
  ReconcileStatus,
  ReconcileTone,
  ReconcileView,
} from '../accounting.domain';

import { formatDay, formatKopecks, formatSavedAt, plural } from '@/shared/utils';

export const RECONCILE_STATUS_LABEL: Record<ReconcileStatus, string> = {
  reconciled: 'Сверено',
  discrepancies: 'Есть расхождения',
  insufficient_data: 'Недостаточно данных',
};

const STATUS_TONE: Record<ReconcileStatus, ReconcileTone> = {
  reconciled: 'ok',
  discrepancies: 'danger',
  // Ждёт документа или загрузки — не поломка (frontend-design: warn — ждёт).
  insufficient_data: 'warn',
};

export const RECONCILE_LINE_STATUS_LABEL: Record<ReconcileLineStatus, string> = {
  matched: 'Сходится',
  mismatch: 'Расхождение',
  no_document: 'Нет документа',
};

const LINE_TONE: Record<ReconcileLineStatus, ReconcileTone> = {
  matched: 'ok',
  mismatch: 'danger',
  no_document: 'outline',
};

export const RECONCILE_REASON_LABEL: Record<ReconcileCandidateReason, string> = {
  duplicate: 'Дубль',
  other_date: 'Другая дата',
  no_pair: 'Нет пары в документе',
};

/** Итоговые строки — под чертой: итог начислений, выплаты (движение денег), остаток. */
const SUMMARY_LINES: Record<ReconcileLineKey, boolean> = {
  sales: false,
  returns: false,
  commission: false,
  logistics: false,
  other_services: false,
  compensations: false,
  unknown: false,
  accrual_total: true,
  payouts: true,
  balance: true,
};

/** Тексты экрана по площадке: чем сверяется и что в документах. */
const MARKETPLACE_TEXT: Record<
  AccountingMarketplace,
  { title: string; subtitle: string; documentsTitle: string; documentsEmpty: string }
> = {
  ym: {
    title: 'Сверка с Маркетом',
    subtitle: 'Суммы реестра по статьям против акта, отчёта об услугах и платёжных поручений.',
    documentsTitle: 'Документы Маркета',
    documentsEmpty: 'За месяц нет ни актов, ни платёжных поручений.',
  },
  ozon: {
    title: 'Сверка с Ozon',
    subtitle: 'Итог начислений и остаток взаиморасчётов против сальдо Ozon за месяц.',
    documentsTitle: 'Документы Ozon',
    documentsEmpty:
      'Актов и поручений у Ozon нет — сальдо месяца сверяется в строках «Итог начислений» и «Остаток взаиморасчётов».',
  },
  wb: {
    title: 'Сверка с WB',
    subtitle:
      'Суммы реестра по статьям. Независимого документа WB в сервисе нет — сверить не с чем.',
    documentsTitle: 'Документы WB',
    documentsEmpty: 'Независимых документов WB в сервисе нет.',
  },
};

const money = (kopecks: number | null) => (kopecks === null ? '—' : formatKopecks(kopecks));

export function toCandidateRow(candidate: ReconcileCandidate): ReconcileCandidateRow {
  const documentDay = candidate.actDay ?? candidate.paidOn;
  return {
    id: candidate.operationId,
    reasonLabel: RECONCILE_REASON_LABEL[candidate.reason],
    amountLabel: formatKopecks(candidate.amountKopecks),
    matchesDifference: candidate.matchesDifference,
    orderLabel: candidate.orderId ? `Заказ ${candidate.orderId}` : 'Без заказа',
    dayLabel: formatDay(candidate.accruedOn),
    documentDayLabel: documentDay ? formatDay(documentDay) : null,
    title: candidate.title,
    manual: candidate.source === 'manual',
  };
}

export function toLineRow(line: ReconcileLineResponse): ReconcileLineRow {
  return {
    key: line.line,
    title: line.title,
    registryLabel: formatKopecks(line.registryKopecks),
    manualLabel: line.manualKopecks ? `в т.ч. ручные ${formatKopecks(line.manualKopecks)}` : null,
    documentLabel: money(line.documentKopecks),
    differenceLabel: money(line.differenceKopecks),
    statusLabel: RECONCILE_LINE_STATUS_LABEL[line.status],
    tone: LINE_TONE[line.status],
    reason: line.reason,
    summary: SUMMARY_LINES[line.line],
    candidates: line.candidates.items.map(toCandidateRow),
    candidateCount: line.candidates.count,
  };
}

function actRow(act: ReconcileActResponse): ReconcileDocumentRow {
  return {
    key: `act:${act.actDay}`,
    title: `Акт от ${formatDay(act.actDay)}`,
    registryLabel: formatKopecks(act.registryKopecks),
    documentLabel: money(act.documentKopecks),
    differenceLabel: money(act.differenceKopecks),
    statusLabel: RECONCILE_LINE_STATUS_LABEL[act.status],
    tone: LINE_TONE[act.status],
    note: act.unknownSheets.length ? `Листы без статьи: ${act.unknownSheets.join(', ')}` : null,
  };
}

function paymentRow(order: ReconcilePaymentOrderResponse): ReconcileDocumentRow {
  return {
    key: `pay:${order.bankOrderId}`,
    title: `Поручение № ${order.bankOrderId} от ${formatDay(order.paidOn)}`,
    registryLabel: formatKopecks(order.registryKopecks),
    documentLabel: money(order.documentKopecks),
    differenceLabel: money(order.differenceKopecks),
    statusLabel: RECONCILE_LINE_STATUS_LABEL[order.status],
    tone: LINE_TONE[order.status],
    note: order.reason,
  };
}

function stampOf(response: ReconcileResponse, now: Date): string {
  const at = formatSavedAt(response.reconciledAt, now) ?? response.reconciledAt;
  const asOf = response.dataAsOf ? formatSavedAt(response.dataAsOf, now) : null;
  return asOf ? `Сверено ${at} · данные на ${asOf}` : `Сверено ${at}`;
}

/** Ответ сервера → вид экрана. Формул нет: числа и статусы — с сервера. */
export function mapReconcile(response: ReconcileResponse, now: Date = new Date()): ReconcileView {
  const noDocument = response.lines.filter(
    (l) => l.status === 'no_document' && l.operationCount > 0,
  );
  const unmatched = response.unmatchedCount;
  return {
    ...MARKETPLACE_TEXT[response.marketplace],
    marketplaceOptions: response.marketplaceOptions.map((o) => ({
      value: o.marketplace,
      label: o.label,
    })),
    statusLabel: RECONCILE_STATUS_LABEL[response.status],
    tone: STATUS_TONE[response.status],
    partialNote:
      response.partial && noDocument.length
        ? `Сверено не всё: без документа — ${noDocument.map((l) => l.title.toLowerCase()).join(', ')}`
        : null,
    notes: response.notes,
    stampLabel: stampOf(response, now),
    unmatchedLabel: unmatched
      ? `${unmatched} ${plural(unmatched, ['операция', 'операции', 'операций'])} без заказа`
      : 'Все операции месяца сопоставлены с заказами',
    lines: response.lines.map(toLineRow),
    documents: [...response.acts.map(actRow), ...response.paymentOrders.map(paymentRow)],
    storeLevel: response.storeLevel.items.map((row) => ({
      id: row.operationId,
      dayLabel: formatDay(row.accruedOn),
      title: row.title,
      amountLabel: formatKopecks(row.amountKopecks),
      manual: row.source === 'manual',
    })),
    storeLevelMore: response.storeLevel.count - response.storeLevel.items.length,
    storeLevelTotalLabel: formatKopecks(response.storeLevel.totalKopecks),
  };
}
