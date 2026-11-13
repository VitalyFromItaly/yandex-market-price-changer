import type {
  AccountingAnalyticsResponse,
  AccountingAnalyticsView,
  AnalyticsAverageResponse,
  AnalyticsChartPoint,
  AnalyticsChartSeries,
  AnalyticsCompareRow,
  AnalyticsMarketplaceDataResponse,
  AnalyticsProductResponse,
  AnalyticsProductRow,
} from '../accounting.domain';

import { DASHBOARD_UNKNOWN_LABEL } from './mapAccountingDashboard.accounting';
import { formatShare } from './mapAccountingReturns.accounting';

import { rangeLabel } from '@/shared/period';
import { formatCount, formatDay, formatKopecks, plural } from '@/shared/utils';

const ORDERS = ['заказ', 'заказа', 'заказов'] as const;
// Родительный после «у»: «у 1 заказа», «у 5 заказов».
const ORDERS_GEN = ['заказа', 'заказов', 'заказов'] as const;
const RETURNS = ['возврат', 'возврата', 'возвратов'] as const;
const DAYS = ['день', 'дня', 'дней'] as const;

const money = (kopecks: number | null) =>
  kopecks === null ? DASHBOARD_UNKNOWN_LABEL : formatKopecks(kopecks);

/** Прибыль с хвостом «у N заказов неизвестна» — сумма неизвестна, если хоть одна неизвестна. */
function profitLabel(kopecks: number | null, unknownCount: number): string {
  if (kopecks !== null) return formatKopecks(kopecks);
  if (unknownCount === 0) return DASHBOARD_UNKNOWN_LABEL;
  return `${DASHBOARD_UNKNOWN_LABEL} у ${formatCount(unknownCount)} ${plural(unknownCount, ORDERS_GEN)}`;
}

function averageLabel(avg: AnalyticsAverageResponse): string {
  if (avg.avgKopecks === null) return '—';
  const share = avg.shareOfRevenue === null ? '' : ` · ${formatShare(avg.shareOfRevenue)}`;
  return `${formatKopecks(avg.avgKopecks)}${share}`;
}

type TData = AnalyticsMarketplaceDataResponse;

const COMPARE: {
  key: string;
  title: string;
  hint?: string;
  cell: (c: TData) => string;
  total?: boolean;
}[] = [
  {
    key: 'orders',
    title: 'Заказов',
    hint: 'Ушедших покупателю',
    cell: (c) => formatCount(c.ordersCount),
  },
  { key: 'revenue', title: 'Выручка', cell: (c) => money(c.revenueKopecks) },
  {
    key: 'profit',
    title: 'Чистая прибыль',
    cell: (c) => profitLabel(c.profitKopecks, c.unknownCount),
    total: true,
  },
  { key: 'margin', title: 'Маржа', cell: (c) => formatShare(c.margin) },
  {
    key: 'commission',
    title: 'Комиссия на заказ',
    hint: 'Средняя по заказам, где комиссия уже пришла из реестра; доля — от их выручки',
    cell: (c) => averageLabel(c.commission),
  },
  {
    key: 'logistics',
    title: 'Логистика на заказ',
    hint: 'Средняя по заказам, где логистика уже пришла из реестра; доля — от их выручки',
    cell: (c) => averageLabel(c.logistics),
  },
];

const TONES: AnalyticsChartSeries['tone'][] = ['c1', 'c2', 'c3'];

function productRow(p: AnalyticsProductResponse): AnalyticsProductRow {
  return {
    key: `${p.marketplace}|${p.offerId}`,
    name: p.offerName ?? p.offerId,
    offerId: p.offerId,
    marketplaceLabel: p.label,
    ordersLabel: `${formatCount(p.ordersCount)} ${plural(p.ordersCount, ORDERS)} · ${formatCount(p.units)} шт.`,
    profitLabel: profitLabel(p.profitKopecks, p.unknownCount),
    isLoss: p.profitKopecks !== null && p.profitKopecks < 0,
  };
}

/**
 * Аналитика «Финучёта» (TASK-231 поверх TASK-230): площадки рядом, площадка без данных —
 * причиной словами, а не нулями; прибыль по дням — ряд на площадку (в одну линию не
 * складываются); ТОПы — с подписью, что в них не вошло. Числа — с сервера.
 */
export function mapAccountingAnalytics(data: AccountingAnalyticsResponse): AccountingAnalyticsView {
  const present = data.marketplaces.filter((m): m is TData => !m.insufficientData);
  const missing = data.marketplaces.flatMap((m) =>
    m.insufficientData ? [{ marketplace: m.marketplace, label: m.label, reason: m.reason }] : [],
  );

  const compare: AnalyticsCompareRow[] = COMPARE.map((m) => ({
    key: m.key,
    title: m.title,
    hint: m.hint ?? null,
    cells: present.map(m.cell),
    total: m.total === true,
  }));

  const series: AnalyticsChartSeries[] = present.map((m, i) => ({
    key: m.marketplace,
    label: m.label,
    tone: TONES[i % TONES.length] ?? 'c1',
  }));
  const labelOf = new Map(present.map((m) => [m.marketplace, m.label]));

  const byDay = new Map<string, AnalyticsChartPoint>();
  let unknownDays = 0;
  for (const d of data.days) {
    if (!labelOf.has(d.marketplace)) continue;
    let point = byDay.get(d.day);
    if (!point) {
      point = {
        key: d.day,
        label: formatDay(d.day).slice(0, 5),
        hint: formatDay(d.day),
        values: {},
      };
      byDay.set(d.day, point);
    }
    // Копейки → рубли для оси; неизвестная прибыль — разрыв, не ноль.
    point.values[d.marketplace] = d.profitKopecks === null ? null : d.profitKopecks / 100;
    if (d.profitKopecks === null) {
      unknownDays += 1;
      point.hint += ` · ${labelOf.get(d.marketplace)}: прибыль неизвестна у ${formatCount(
        d.unknownCount,
      )} ${plural(d.unknownCount, ORDERS_GEN)}`;
    }
  }
  const points = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key));

  const productsNotes: string[] = [];
  const { multiModelOrders, unknownModels } = data.products;
  if (multiModelOrders > 0) {
    productsNotes.push(
      `Заказов из нескольких моделей, не разнесённых по товарам: ${formatCount(multiModelOrders)}`,
    );
  }
  if (unknownModels > 0) {
    productsNotes.push(
      `Моделей с неизвестной прибылью, не вошедших в ТОП: ${formatCount(unknownModels)}`,
    );
  }

  const { orders: lossOrders, total: lossTotal } = data.lossOrders;
  const { models: returnModels, multiModelReturns } = data.returnModels;

  return {
    periodLabel: rangeLabel(data.period),
    columns: present.map((m) => ({ marketplace: m.marketplace, label: m.label })),
    missing,
    compare,
    series,
    points,
    unknownDaysNote:
      unknownDays > 0
        ? `${formatCount(unknownDays)} ${plural(unknownDays, DAYS)} с неизвестной прибылью — на графике разрыв, не ноль`
        : null,
    mostProfitable: data.products.mostProfitable.map(productRow),
    leastProfitable: data.products.leastProfitable.map(productRow),
    productsNotes,
    lossOrders: lossOrders.map((o) => ({
      key: `${o.marketplace}|${o.orderId}`,
      marketplace: o.marketplace,
      orderId: o.orderId,
      title: o.title || 'Без названия',
      marketplaceLabel: o.label,
      dayLabel: o.createdOn ? formatDay(o.createdOn) : '—',
      resultLabel: formatKopecks(o.resultKopecks),
    })),
    lossOrdersNote:
      lossTotal > lossOrders.length
        ? `Показано ${formatCount(lossOrders.length)} из ${formatCount(lossTotal)}`
        : null,
    returnModels: returnModels.map((m) => ({
      key: `${m.marketplace}|${m.offerId}`,
      name: m.offerName ?? m.offerId,
      offerId: m.offerId,
      marketplaceLabel: m.label,
      returnedLabel: `${formatCount(m.returnedOrders)} ${plural(m.returnedOrders, RETURNS)} · ${formatCount(m.returnedUnits)} шт.`,
      resultLabel: money(m.resultKopecks),
    })),
    returnModelsNote:
      multiModelReturns > 0
        ? `Возвратов из нескольких моделей, не разнесённых по моделям: ${formatCount(multiModelReturns)}`
        : null,
    multiColumn: present.length > 1,
  };
}
