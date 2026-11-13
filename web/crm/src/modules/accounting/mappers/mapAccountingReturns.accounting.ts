import type {
  AccountingReturnsMarketplaceResponse,
  AccountingReturnsMetricRow,
  AccountingReturnsResponse,
  AccountingReturnsView,
} from '../accounting.domain';

import { monthLabel } from '@/shared/period';
import { formatCount, formatDay, formatKopecks, plural } from '@/shared/utils';

/** Неизвестное — словом, никогда «0 ₽» (неизвестная себестоимость не ноль). */
export const RETURNS_UNKNOWN_LABEL = 'Неизвестно';

const money = (kopecks: number | null) =>
  kopecks === null ? RETURNS_UNKNOWN_LABEL : formatKopecks(kopecks);

export function formatShare(rate: number | null): string {
  if (rate === null) return '—';
  return `${(Math.round(rate * 1000) / 10).toLocaleString('ru-RU')} %`;
}

type TColumn = AccountingReturnsMarketplaceResponse;

interface IMetric {
  key: string;
  title: string;
  hint?: string;
  cell: (c: TColumn) => string;
  total?: boolean;
  /** Строка показывается, только если у какой-то площадки не ноль. */
  optional?: (c: TColumn) => boolean;
}

// Родительный: «у 1 заказа», «у 2 заказов», «у 5 заказов».
const ORDERS = ['заказа', 'заказов', 'заказов'] as const;

const METRICS: IMetric[] = [
  {
    key: 'count',
    title: 'Возвратов',
    cell: (c) => `${formatCount(c.returnedCount)} из ${formatCount(c.ordersCount)}`,
  },
  {
    key: 'rate',
    title: 'Доля от продаж',
    hint: 'Возвращённые заказы от ушедших покупателю за месяц оформления',
    cell: (c) => formatShare(c.returnRate),
  },
  {
    key: 'value',
    title: 'Стоимость возвращённого',
    hint: 'Выручка вернувшихся позиций',
    cell: (c) => money(c.returnedValueKopecks),
  },
  { key: 'delivery', title: 'Логистика до покупателя', cell: (c) => money(c.deliveryKopecks) },
  {
    key: 'reverse',
    title: 'Обратная логистика',
    hint: 'Обратная доставка, обработка и хранение возврата',
    cell: (c) => money(c.reverseKopecks),
  },
  {
    key: 'withheld',
    title: 'Удержания',
    hint: 'Невозвращённые комиссия и эквайринг, штрафы и прочие услуги',
    cell: (c) => money(c.withheldKopecks),
  },
  { key: 'compensations', title: 'Компенсации', cell: (c) => money(c.compensationsKopecks) },
  {
    key: 'writeOff',
    title: 'Списание товара',
    hint: 'Повреждённый или утраченный возврат — по партиям',
    cell: (c) => money(c.writeOffKopecks),
    optional: (c) => c.writeOffKopecks !== 0,
  },
  {
    key: 'repacking',
    title: 'Повторная упаковка',
    cell: (c) => money(c.repackingKopecks),
    optional: (c) => c.repackingKopecks !== 0,
  },
  {
    key: 'result',
    title: 'Итог возвратов',
    hint: 'Сумма результатов возвращённых заказов',
    cell: (c) =>
      c.resultKopecks === null
        ? `${RETURNS_UNKNOWN_LABEL} у ${formatCount(c.unknownCount)} ${plural(c.unknownCount, ORDERS)}`
        : formatKopecks(c.resultKopecks),
    total: true,
  },
];

export function mapAccountingReturns(data: AccountingReturnsResponse): AccountingReturnsView {
  const columns = data.marketplaces;
  const labelOf = new Map(columns.map((c) => [c.marketplace, c.label]));
  const metrics: AccountingReturnsMetricRow[] = METRICS.filter(
    (m) => !m.optional || columns.some(m.optional),
  ).map((m) => ({
    key: m.key,
    title: m.title,
    hint: m.hint ?? null,
    cells: columns.map(m.cell),
    total: m.total === true,
  }));

  return {
    periodLabel: monthLabel(data.period.from.slice(0, 7)),
    columns: columns.map((c) => ({ marketplace: c.marketplace, label: c.label })),
    hasReturns: columns.some((c) => c.returnedCount > 0),
    metrics,
    models: data.models.map((m) => ({
      key: `${m.marketplace}|${m.offerId}`,
      name: m.offerName ?? m.offerId,
      offerId: m.offerId,
      marketplaceLabel: m.label,
      returnedLabel: `${formatCount(m.returnedUnits)} из ${formatCount(m.soldUnits)} шт.`,
      rateLabel: formatShare(m.returnRate),
    })),
    orders: data.orders.map((o) => ({
      key: `${o.marketplace}|${o.orderId}`,
      marketplace: o.marketplace,
      orderId: o.orderId,
      title: o.title || 'Без названия',
      marketplaceLabel: labelOf.get(o.marketplace) ?? o.marketplace,
      dayLabel: o.returnedOn ? formatDay(o.returnedOn) : '—',
      logisticsLabel: formatKopecks(o.logisticsKopecks),
      resultLabel: money(o.resultKopecks),
      isLoss: o.resultKopecks !== null && o.resultKopecks < 0,
    })),
  };
}
