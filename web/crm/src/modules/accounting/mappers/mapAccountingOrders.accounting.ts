import type {
  AccountingMarketplace,
  AccountingOrderRow,
  AccountingOrdersResponse,
  AccountingOrdersRowResponse,
  AccountingOrdersView,
  OrderProfitState,
  OrderStateTone,
} from '../accounting.domain';

import { monthLabel } from '@/shared/period';
import { formatCount, formatDay, formatKopecks, plural } from '@/shared/utils';

/** Окончательная — «в норме»; прогноз и предварительная ждут, а не сломались. */
export const ORDER_STATE_TONE: Record<OrderProfitState, OrderStateTone> = {
  forecast: 'warn',
  preliminary: 'warn',
  reconciled: 'ok',
};

/** Неизвестная прибыль — словом, никогда «0 ₽» (неизвестная закупка не ноль). */
export const UNKNOWN_PROFIT_LABEL = 'Неизвестно';

/** Подписи площадок — с сервера (`marketplaceOptions`); общего словаря на фронте нет. */
export function marketplaceLabels(
  options: AccountingOrdersResponse['marketplaceOptions'],
): (marketplace: AccountingMarketplace) => string {
  const byKey = new Map(options.map((o) => [o.marketplace, o.label]));
  return (marketplace) => byKey.get(marketplace) ?? marketplace;
}

const MAX_OFFERS_SHOWN = 2;

function offersLabel(names: string[], units: number): string {
  const shown = names.slice(0, MAX_OFFERS_SHOWN).join(', ');
  const more = names.length - MAX_OFFERS_SHOWN;
  const head = shown || 'Без названия';
  const tail = more > 0 ? ` и ещё ${more}` : '';
  return `${head}${tail} · ${formatCount(units)} шт.`;
}

export function toAccountingOrderRow(
  row: AccountingOrdersRowResponse,
  labelOf: (marketplace: AccountingMarketplace) => string,
): AccountingOrderRow {
  return {
    key: `${row.marketplace}|${row.orderId}`,
    marketplace: row.marketplace,
    orderId: row.orderId,
    dayLabel: row.createdOn ? formatDay(row.createdOn) : '—',
    offersLabel: offersLabel(row.offerNames, row.units),
    marketplaceLabel: labelOf(row.marketplace),
    revenueLabel: row.revenueKopecks === null ? '—' : formatKopecks(row.revenueKopecks),
    confirmedLabel: formatKopecks(row.confirmedKopecks),
    expectedLabel: row.expectedKopecks === 0 ? null : formatKopecks(row.expectedKopecks),
    netLabel: row.netKopecks === null ? UNKNOWN_PROFIT_LABEL : formatKopecks(row.netKopecks),
    netUnknown: row.netKopecks === null,
    isLoss: row.isLoss,
    stateLabel: row.stateTitle,
    stateTone: ORDER_STATE_TONE[row.state],
  };
}

/** Ответ `accounting:orders` → вид секции. Все суммы и состояния — с сервера. */
export function mapAccountingOrders(response: AccountingOrdersResponse): AccountingOrdersView {
  const labelOf = marketplaceLabels(response.marketplaceOptions);
  const { totals } = response;
  const unknownNote = totals.unknownCount
    ? `Без ${formatCount(totals.unknownCount)} ${plural(totals.unknownCount, [
        'заказа',
        'заказов',
        'заказов',
      ])} с неизвестной прибылью`
    : null;
  const lossLabel = totals.lossCount
    ? `${formatCount(totals.lossCount)} ${plural(totals.lossCount, [
        'убыточный',
        'убыточных',
        'убыточных',
      ])}`
    : null;
  const final = response.rows.length > 0 && response.rows.every((r) => r.state === 'reconciled');
  return {
    rows: response.rows.map((row) => toAccountingOrderRow(row, labelOf)),
    periodLabel: monthLabel(response.period.from.slice(0, 7)),
    costMethodLabel: `Общие расходы: ${response.costMethod.toLowerCase()}`,
    totals: {
      countLabel: `${formatCount(totals.count)} ${plural(totals.count, ['заказ', 'заказа', 'заказов'])}`,
      confirmedLabel: formatKopecks(totals.confirmedKopecks),
      expectedLabel: formatKopecks(totals.expectedKopecks),
      netLabel: formatKopecks(totals.netKopecks),
      netTitle: final ? 'Прибыль заказов' : 'Прибыль заказов (не окончательная)',
      netCaption: [lossLabel, unknownNote].filter(Boolean).join(' · ') || null,
      unknownNote,
      lossLabel,
      unallocatedLabel: response.unallocatedKopecks
        ? `Не распределено на заказы: ${formatKopecks(response.unallocatedKopecks)}`
        : null,
    },
    marketplaceOptions: response.marketplaceOptions.map((o) => ({
      value: o.marketplace,
      label: o.label,
    })),
    stateOptions: response.stateOptions.map((o) => ({ value: o.key, label: o.label })),
  };
}
