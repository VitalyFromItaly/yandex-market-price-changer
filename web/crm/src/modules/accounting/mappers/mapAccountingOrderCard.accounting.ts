import type {
  AccountingOrderCardResponse,
  AccountingOrderCardView,
  OrderAmountKey,
  OrderAmountRow,
  OrderAmountTag,
  OrderCardAmountResponse,
  OrderCardCostLineResponse,
  OrderCardOperationResponse,
  OrderCostLineRow,
  OrderOperationRow,
  OrderProfitReason,
  OrderProfitState,
} from '../accounting.domain';

import { ORDER_STATE_TONE, UNKNOWN_PROFIT_LABEL } from './mapAccountingOrders.accounting';

import {
  formatCount,
  formatDay,
  formatKopecks,
  formatMoscowDate,
  formatSavedAt,
} from '@/shared/utils';

/** Метки строки суммы — слова ТЗ: «ожидается», «распределено», «оценка», «Неизвестная закупка». */
export const ORDER_AMOUNT_TAG_LABEL: Record<OrderAmountTag, string> = {
  expected: 'ожидается',
  allocated: 'распределено',
  estimate: 'оценка',
  unknown_cogs: 'Неизвестная закупка',
  unknown: 'неизвестно',
};

/** Почему сумма неизвестна — словами продавца. Текст показа, не расчёт. */
export const ORDER_REASON_LABEL: Record<OrderProfitReason, string> = {
  'no-operations': 'Начислений по заказу ещё нет',
  'no-line-value': 'Площадка ещё не прислала сумму позиции',
  'no-record':
    'Нет закупочной цены на момент продажи — загрузите прайс или исправьте историю закупа',
  unconvertible: 'Закуп в валюте, для которой нет курса',
  'no-product': 'Товар не найден в справочнике товаров',
  'no-sale-moment': 'Неизвестен день продажи',
  'no-lot': 'Нет партии закупки под эту продажу — внесите закупку с позициями',
  'no-lines': 'Строки заказа ещё не загружены',
  forecast: 'Оценка по ставкам — начислений ещё нет',
};

/** Подписи состояний версий — те же, что у бота и сервера (`ORDER_PROFIT_STATE_TITLE`). */
export const ORDER_STATE_LABEL: Record<OrderProfitState, string> = {
  forecast: 'Прогноз',
  preliminary: 'Предварительно',
  reconciled: 'Сверено',
};

export const UNKNOWN_COGS_LABEL = ORDER_AMOUNT_TAG_LABEL.unknown_cogs;

/** Неизвестная сумма: у себестоимости — «Неизвестная закупка», у прочих — «Неизвестно». */
const unknownLabel = (key: OrderAmountKey | undefined) =>
  key === 'cogs' ? UNKNOWN_COGS_LABEL : UNKNOWN_PROFIT_LABEL;

const reasonText = (reason: string | null): string | null =>
  reason === null ? null : (ORDER_REASON_LABEL[reason as OrderProfitReason] ?? reason);

export function toOrderOperationRow(
  op: OrderCardOperationResponse,
  marketplaceLabel: string,
): OrderOperationRow {
  return {
    id: op.id,
    title: op.title,
    amountLabel: formatKopecks(op.kopecks),
    dayLabel: formatDay(op.accruedOn),
    marketplaceLabel,
    documentLabel: op.documentId ?? '—',
    manual: op.origin === 'manual',
  };
}

export function toOrderCostLineRow(line: OrderCardCostLineResponse): OrderCostLineRow {
  const total = line.totalKopecks ?? null;
  const unknown = line.unitKopecks === null && total === null;
  const from = line.recordFrom ? formatMoscowDate(line.recordFrom) : null;
  let note: string | null = from ? `Закуп с ${from}` : null;
  // Режим Б: штуки из партий — день поступления и сколько штук.
  if (line.portions?.length) {
    note = `Партии: ${line.portions.map((p) => `${formatDay(p.receivedDay)} × ${formatCount(p.units)}`).join(', ')}`;
  }
  if (unknown) note = reasonText(line.reason);
  let unitLabel = UNKNOWN_COGS_LABEL;
  if (line.unitKopecks !== null) unitLabel = formatKopecks(line.unitKopecks);
  else if (total !== null) unitLabel = `${formatKopecks(total)} за все`;
  return {
    key: line.itemId,
    title: line.offerName ?? line.offerId ?? line.itemId,
    countLabel: `${formatCount(line.count)} шт.`,
    unitLabel,
    unknown,
    note,
  };
}

function tagsOf(amount: OrderCardAmountResponse): OrderAmountRow['tags'] {
  const tags: OrderAmountTag[] = [];
  if (amount.source === 'unknown') tags.push(amount.key === 'cogs' ? 'unknown_cogs' : 'unknown');
  if (amount.source === 'expected') tags.push('expected');
  if (amount.source === 'allocated') tags.push('allocated');
  if (amount.reason === 'forecast') tags.push('estimate');
  return tags.map((tag) => ({ tag, label: ORDER_AMOUNT_TAG_LABEL[tag] }));
}

function notesOf(amount: OrderCardAmountResponse): string[] {
  const notes: string[] = [];
  if (amount.method) {
    const period = amount.allocationPeriod
      ? ` · расходы ${formatDay(amount.allocationPeriod.from)} — ${formatDay(amount.allocationPeriod.to)}`
      : '';
    notes.push(`${amount.method}${period}`);
  }
  if (amount.basis) notes.push(amount.basis);
  // «Прочие расходы»: из каких записей «Расходов» сложилась сумма.
  for (const expense of amount.expenses ?? []) {
    notes.push(`${expense.title}: ${formatKopecks(expense.kopecks)}`);
  }
  if (amount.note) notes.push(amount.note);
  const reason = amount.kopecks === null ? reasonText(amount.reason) : null;
  if (reason) notes.push(reason);
  return notes;
}

export function toOrderAmountRow(
  amount: OrderCardAmountResponse,
  marketplaceLabel: string,
): OrderAmountRow {
  const operations = amount.operations.map((op) => toOrderOperationRow(op, marketplaceLabel));
  const costLines = (amount.costLines ?? []).map(toOrderCostLineRow);
  const unknown = amount.kopecks === null;
  return {
    key: amount.key,
    title: amount.title,
    amountLabel: amount.kopecks === null ? unknownLabel(amount.key) : formatKopecks(amount.kopecks),
    unknown,
    tags: tagsOf(amount),
    notes: notesOf(amount),
    operations,
    costLines,
    expandable: operations.length > 0 || costLines.length > 0,
  };
}

function unknownNoteOf(card: AccountingOrderCardResponse): string | null {
  if (card.netKopecks !== null || card.unknown === null) return null;
  const { key, reason } = card.unknown;
  const title = card.amounts.find((a) => a.key === key)?.title ?? key;
  const head = key === 'cogs' ? UNKNOWN_COGS_LABEL : `Неизвестно: ${title}`;
  const why = reasonText(reason);
  return why ? `${head}. ${why}` : head;
}

const money = (kopecks: number | null) => (kopecks === null ? '—' : formatKopecks(kopecks));

/** Ответ `accounting:order` → вид карточки. Все суммы и состояния — с сервера. */
export function mapAccountingOrderCard(card: AccountingOrderCardResponse): AccountingOrderCardView {
  const net = card.netKopecks;
  const netUnknown = net === null;
  const day = card.createdOn ? ` от ${formatDay(card.createdOn)}` : '';
  return {
    title: `Заказ ${card.orderId}`,
    subtitle: `${card.marketplaceLabel}${day}`,
    stateLabel: card.stateTitle,
    stateHint: card.stateHint,
    stateTone: ORDER_STATE_TONE[card.state],
    provisionalNote: card.final ? null : 'Прибыль не окончательная',
    confirmedLabel: formatKopecks(card.confirmedKopecks),
    expectedLabel: formatKopecks(card.expectedKopecks),
    netLabel: net === null ? unknownLabel(card.unknown?.key) : formatKopecks(net),
    netUnknown,
    unknownNote: unknownNoteOf(card),
    isLoss: net !== null && net < 0,
    cogsMethodLabel: `Себестоимость: ${card.cogsMethodTitle}`,
    amounts: card.amounts.map((amount) => toOrderAmountRow(amount, card.marketplaceLabel)),
    reference: card.reference.map((op) => toOrderOperationRow(op, card.marketplaceLabel)),
    prices: [
      { label: 'Цена для покупателя', value: money(card.prices.buyerKopecks) },
      { label: 'Цена продавца', value: money(card.prices.sellerKopecks) },
      { label: 'К признанию', value: money(card.prices.recognizedKopecks) },
      { label: 'Скидка площадки', value: money(card.prices.marketplaceDiscountKopecks) },
    ],
    versions: card.versions.map((v) => ({
      key: String(v.version),
      label: `Версия ${v.version} · ${v.reasonTitle}`,
      stateLabel: ORDER_STATE_LABEL[v.state],
      netLabel: v.netKopecks === null ? UNKNOWN_PROFIT_LABEL : formatKopecks(v.netKopecks),
      atLabel: formatSavedAt(v.capturedAt) ?? '—',
    })),
  };
}
