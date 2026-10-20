import type {
  CompareColumn,
  CompareMarketplace,
  CompareMetricDef,
  ComparePeriodStatus,
  MarketplaceCompareResponse,
  MetricFormat,
} from '../marketplace-compare.domain';
import type { BarPoint, ChartTone, Segment } from '@/components/ui/chart';
import type { DayRange } from '@/shared/utils';
import type { RouteLocationRaw } from 'vue-router';

import { COMPARE_METRICS } from '../marketplace-compare.domain';

import { rangeQuery } from '@/shared/period';
import { formatCount, formatKopecks } from '@/shared/utils';

/** Цвет площадки на графиках — один на экран, легенда подписывает его словами. */
export const MARKETPLACE_TONE: Record<CompareMarketplace, ChartTone> = {
  ym: 'c1',
  ozon: 'c2',
  wb: 'c3',
};

export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1).replace('.', ',')} %`;
}

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value === null) return '—';
  if (format === 'money') return formatKopecks(value);
  if (format === 'count') return formatCount(value);
  return formatShare(value);
}

/** Ячейка ведёт в «Прибыль» своей площадки за тот же период. */
export function financeLink(marketplace: CompareMarketplace, period: DayRange): RouteLocationRaw {
  return {
    name: 'ym-finance',
    params: { tab: 'pnl' },
    query: { ...rangeQuery(period), marketplace },
  };
}

export interface CompareCell {
  marketplace: CompareMarketplace;
  text: string;
  /** null — чисел нет (закрыто или нет журнала), ссылки тоже. */
  to: RouteLocationRaw | null;
}

export interface CompareRow {
  key: string;
  label: string;
  strong: boolean;
  cells: CompareCell[];
}

function cellOf(def: CompareMetricDef, column: CompareColumn, period: DayRange): CompareCell {
  if (column.state !== 'ok' || column.metrics === null) {
    return { marketplace: column.marketplace, text: '—', to: null };
  }
  return {
    marketplace: column.marketplace,
    text: formatMetric(def.pick(column.metrics), def.format),
    to: financeLink(column.marketplace, period),
  };
}

export function compareRows(data: MarketplaceCompareResponse): CompareRow[] {
  return COMPARE_METRICS.map((def) => ({
    key: def.key,
    label: def.label,
    strong: def.strong === true,
    cells: data.columns.map((column) => cellOf(def, column, data.period)),
  }));
}

export type StatusTone = 'ok' | 'warn' | 'danger' | 'outline';

export function statusTone(status: ComparePeriodStatus | null): StatusTone {
  if (status === 'verified') return 'ok';
  if (status === 'discrepancy') return 'danger';
  return status === null ? 'outline' : 'warn';
}

/** Доля выручки — только площадки с выручкой > 0: отрицательная доля смысла не имеет. */
export function revenueSegments(data: MarketplaceCompareResponse): Segment<CompareMarketplace>[] {
  return data.columns.flatMap((column) =>
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

/** Услуги площадки к выручке, в процентах — всегда ≥ 0, поэтому столбики. */
export function costSharePoints(data: MarketplaceCompareResponse): BarPoint[] {
  return data.columns.flatMap((column) =>
    column.metrics && column.metrics.costShare !== null
      ? [{ key: column.marketplace, label: column.label, value: column.metrics.costShare * 100 }]
      : [],
  );
}

export function percentLabel(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} %`;
}

/** Подпись площадки по ключу — из колонок ответа, а не своей копией. */
export function marketplaceLabel(
  data: MarketplaceCompareResponse,
  key: CompareMarketplace,
): string {
  return data.columns.find((column) => column.marketplace === key)?.label ?? key;
}

/** Колонок с числами — графики и выводы осмысленны только от двух. */
export function numberedColumns(data: MarketplaceCompareResponse): number {
  return data.columns.filter((column) => column.state === 'ok').length;
}

export interface SchemeRow {
  key: string;
  marketplace: string;
  scheme: string;
  revenue: string;
  net: string;
  margin: string;
}

/** Схемы продаж всех площадок одной таблицей: сравниваются маржи, не суммы. */
export function schemeRows(data: MarketplaceCompareResponse): SchemeRow[] {
  return data.columns.flatMap((column) =>
    column.schemes.map((scheme) => ({
      key: `${column.marketplace}:${scheme.scheme}`,
      marketplace: column.label,
      scheme: scheme.scheme,
      revenue: formatKopecks(scheme.revenueKopecks),
      net: formatKopecks(scheme.netKopecks),
      margin: scheme.margin === null ? '—' : formatShare(scheme.margin),
    })),
  );
}
