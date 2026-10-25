import type {
  DashboardColumn,
  DashboardDay,
  DashboardMarketplace,
  DashboardMetric,
  MarketplacesDashboardResponse,
} from '../marketplaces-dashboard.domain';
import type { AreaPoint, AreaSeries, BarPoint, Segment } from '@/components/ui/chart';
import type { CompareMetrics } from '@/modules/marketplace-compare/marketplace-compare.domain';
import type { TimeGrain } from '@/shared/period';
import type { DayRange } from '@/shared/utils';
import type { RouteLocationRaw } from 'vue-router';

import { fillDays } from '@/components/ui/chart';
import { MARKETPLACE_COMPARE_ROUTE_NAME } from '@/modules/marketplace-compare/marketplace-compare.domain';
import { MARKETPLACE_TONE, financeLink } from '@/shared/marketplaces';
import { bucketKey, bucketLabel, rangeDays, rangeQuery } from '@/shared/period';
import { formatCount, formatKopecks } from '@/shared/utils';

/**
 * Вид дашборда «Площадки» из ответа задачи. Ничего не пересчитывается: KPI — поля
 * колонки «Сравнения площадок», недели — суммы дней (Σ корзин = выручке колонки).
 * Единственная арифметика вида — доля площадки в выручке, та же, что рисует
 * `SegmentBar` «Сравнения площадок». Чисел у колонки нет — «нет данных» с причиной,
 * а не нули, и в доли и графики она не входит.
 */

export function formatShare(share: number | null): string {
  return share === null ? '—' : `${(share * 100).toFixed(1).replace('.', ',')} %`;
}

/** «Сравнение площадок» за тот же период — детализация любого показателя дашборда. */
export function compareLink(period: DayRange): RouteLocationRaw {
  return { name: MARKETPLACE_COMPARE_ROUTE_NAME, query: rangeQuery(period) };
}

const hasNumbers = (
  column: DashboardColumn,
): column is DashboardColumn & { metrics: CompareMetrics } =>
  column.state === 'ok' && column.metrics !== null;

/** Колонки с числами — по ним графики; от двух дашборду есть что сравнивать. */
export function numberedColumns(data: MarketplacesDashboardResponse): DashboardColumn[] {
  return data.columns.filter(hasNumbers);
}

/** Выручка всех площадок с положительной выручкой — знаменатель доли. */
function positiveRevenue(data: MarketplacesDashboardResponse): number {
  return data.columns
    .filter(hasNumbers)
    .reduce((sum, column) => sum + Math.max(column.metrics.revenueKopecks, 0), 0);
}

export type KpiTone = 'neutral' | 'danger';

export interface DashboardKpi {
  key: string;
  label: string;
  value: string;
  tone: KpiTone;
}

export type StatusTone = 'ok' | 'warn' | 'danger';

export interface DashboardCard {
  marketplace: DashboardMarketplace;
  label: string;
  statusLabel: string | null;
  /** Цвет бейджа статуса периода: проверен — ok, расхождение — danger, иначе warn. */
  statusTone: StatusTone;
  /** «Финансы» площадки за тот же период. */
  to: RouteLocationRaw;
  /** Почему чисел нет; null — числа есть. */
  reason: string | null;
  kpis: DashboardKpi[];
}

function kpisOf(metrics: CompareMetrics, share: number | null): DashboardKpi[] {
  const money = (value: number | null) => (value === null ? '—' : formatKopecks(value));
  return [
    { key: 'revenue', label: 'Выручка', value: money(metrics.revenueKopecks), tone: 'neutral' },
    {
      key: 'net',
      label: 'Чистая прибыль',
      value: money(metrics.netKopecks),
      tone: metrics.netKopecks < 0 ? 'danger' : 'neutral',
    },
    {
      key: 'margin',
      label: 'Маржа',
      value: formatShare(metrics.netMargin),
      tone: metrics.netMargin !== null && metrics.netMargin < 0 ? 'danger' : 'neutral',
    },
    { key: 'orders', label: 'Заказы', value: formatCount(metrics.orders), tone: 'neutral' },
    { key: 'avg', label: 'Средний чек', value: money(metrics.avgCheckKopecks), tone: 'neutral' },
    {
      key: 'returns',
      label: 'Возвраты',
      value: formatShare(metrics.returnsShare),
      tone: 'neutral',
    },
    { key: 'share', label: 'Доля в выручке', value: formatShare(share), tone: 'neutral' },
  ];
}

function statusToneOf(column: DashboardColumn): StatusTone {
  if (column.status === 'verified') return 'ok';
  return column.status === 'discrepancy' ? 'danger' : 'warn';
}

export function dashboardCards(data: MarketplacesDashboardResponse): DashboardCard[] {
  const total = positiveRevenue(data);
  return data.columns.map((column) => {
    const base = {
      marketplace: column.marketplace,
      label: column.label,
      statusLabel: column.statusLabel,
      statusTone: statusToneOf(column),
      to: financeLink(column.marketplace, data.period),
    };
    if (!hasNumbers(column)) {
      return { ...base, reason: column.reason ?? 'Нет данных за период.', kpis: [] };
    }
    const revenue = column.metrics.revenueKopecks;
    const share = total > 0 && revenue > 0 ? revenue / total : null;
    return { ...base, reason: null, kpis: kpisOf(column.metrics, share) };
  });
}

/** Доля выручки — только площадки с выручкой > 0: отрицательная доля смысла не имеет. */
export function revenueSegments(
  data: MarketplacesDashboardResponse,
): Segment<DashboardMarketplace>[] {
  return numberedColumns(data).flatMap((column) =>
    column.metrics && column.metrics.revenueKopecks > 0
      ? [
          {
            key: column.marketplace,
            label: column.label,
            value: column.metrics.revenueKopecks,
            tone: MARKETPLACE_TONE[column.marketplace],
          },
        ]
      : [],
  );
}

/** Столбики по площадкам с числами; null показателя — площадки на графике нет. */
export function barPoints(
  data: MarketplacesDashboardResponse,
  pick: (metrics: CompareMetrics) => number | null,
): BarPoint[] {
  return numberedColumns(data).flatMap((column) => {
    const value = column.metrics ? pick(column.metrics) : null;
    return value === null ? [] : [{ key: column.marketplace, label: column.label, value }];
  });
}

export const pickNetRub = (metrics: CompareMetrics): number => metrics.netKopecks / 100;
export const pickMarginPct = (metrics: CompareMetrics): number | null =>
  metrics.netMargin === null ? null : metrics.netMargin * 100;
export const pickReturnsPct = (metrics: CompareMetrics): number | null =>
  metrics.returnsShare === null ? null : metrics.returnsShare * 100;

/** Шаг ряда по длине периода: до 45 дней — дни, до полугода — недели, дальше — месяцы. */
export function grainOf(period: DayRange): TimeGrain {
  const days = rangeDays(period);
  if (days <= 45) return 'day';
  return days <= 200 ? 'week' : 'month';
}

const METRIC_VALUE: Record<DashboardMetric, (day: DashboardDay) => number> = {
  revenue: (day) => day.revenueKopecks / 100,
  orders: (day) => day.orders,
};

/** Ряды графика — площадки с числами, цвет площадки один на всех экранах. */
export function timeSeries(data: MarketplacesDashboardResponse): AreaSeries[] {
  return numberedColumns(data).map((column) => ({
    key: column.marketplace,
    label: column.label,
    tone: MARKETPLACE_TONE[column.marketplace],
  }));
}

/**
 * Точки графика во времени: пустые дни — нулями по границам периода (неделя без
 * продаж не пропадает со шкалы), затем сумма дней по корзине — то же правило, что
 * у «Аналитики продаж» (`shared/period/timeBucket`).
 */
export function timePoints(
  data: MarketplacesDashboardResponse,
  metric: DashboardMetric,
  grain: TimeGrain,
): AreaPoint[] {
  const columns = numberedColumns(data);
  const zero = (date: string) => ({ date, day: date, revenueKopecks: 0, units: 0, orders: 0 });
  const axis = fillDays([], data.period.from, data.period.to, zero);
  const buckets = new Map<string, AreaPoint & { first: string; last: string }>();
  for (const { day } of axis) {
    const key = bucketKey(day, grain);
    const entry = buckets.get(key) ?? {
      key,
      label: '',
      first: day,
      last: day,
      values: Object.fromEntries(columns.map((column) => [column.marketplace, 0])),
    };
    entry.last = day;
    buckets.set(key, entry);
  }
  for (const column of columns) {
    for (const day of column.days) {
      const entry = buckets.get(bucketKey(day.day, grain));
      if (entry) {
        entry.values[column.marketplace] =
          (entry.values[column.marketplace] ?? 0) + METRIC_VALUE[metric](day);
      }
    }
  }
  return [...buckets.values()].map(({ first, last, ...point }) => ({
    ...point,
    label: bucketLabel(grain, first, last),
  }));
}
