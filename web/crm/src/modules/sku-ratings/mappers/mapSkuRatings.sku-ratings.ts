import type {
  ClassFilter,
  ClassRow,
  ClassSummary,
  ClassSummaryRow,
  RatingSku,
  RatingThresholds,
  Tone,
  TopRow,
} from '../sku-ratings.domain';

import { formatCount, formatKopecks, plural } from '@/shared/utils';

const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** Доля (0,234) → «23,4 %». */
export function formatShare(value: number): string {
  return `${PERCENT.format(value * 100)} %`;
}

const percentOf = (value: number) => PERCENT.format(Math.round(value * 1000) / 10);

/**
 * Пороги словами — из ответа сервера, своих чисел у экрана нет. Доли ABC
 * печатаются как ширина класса: A — первые 80 %, B — следующие 15 %, C — 5 %.
 */
export function thresholdLines(t: RatingThresholds): {
  abc: string[];
  xyz: string[];
  rules: string[];
} {
  return {
    abc: [
      `A — товары, которые дают первые ${percentOf(t.abc.a)} %`,
      `B — следующие ${percentOf(t.abc.b - t.abc.a)} %`,
      `C — остальные ${percentOf(1 - t.abc.b)} %`,
    ],
    xyz: [
      `X — недельные продажи колеблются не больше чем на ${percentOf(t.xyz.x)} %`,
      `Y — от ${percentOf(t.xyz.x)} до ${percentOf(t.xyz.y)} %`,
      `Z — больше ${percentOf(t.xyz.y)} %: спрос случайный`,
    ],
    rules: [
      `В каждом рейтинге — первые ${t.topSize} товаров.`,
      `Неделя — ${t.weekDays} дней от начала периода, неполная последняя не считается; ` +
        `XYZ — от ${t.minWeeks} полных недель.`,
    ],
  };
}

const titleOf = (row: RatingSku) => ({
  title: row.name ?? row.sku,
  subtitle: row.name ? row.sku : null,
});

const units = (value: number) => `${formatCount(value)} шт.`;

function toneOf(delta: number): Tone {
  if (delta > 0) return 'ok';
  return delta < 0 ? 'danger' : 'muted';
}

/** Спрос строкой: «3 → 5 шт.», «новый, 5 шт.». */
export function demandOf(row: RatingSku): { text: string; tone: Tone } {
  const tone = toneOf(row.unitsDelta);
  if (row.previousUnits === null) return { text: `новый, ${units(row.units)}`, tone };
  return { text: `${formatCount(row.previousUnits)} → ${units(row.units)}`, tone };
}

export function topRow(row: RatingSku, index: number): TopRow {
  const demand = demandOf(row);
  return {
    key: row.sku,
    place: index + 1,
    ...titleOf(row),
    revenue: formatKopecks(row.revenueKopecks),
    net: row.costKnown ? formatKopecks(row.netKopecks) : 'нет закупа',
    units: units(row.units),
    margin: row.margin === null ? '—' : formatShare(row.margin),
    demand: demand.text,
    demandTone: demand.tone,
  };
}

export function classRow(row: RatingSku): ClassRow {
  return {
    key: row.sku,
    ...titleOf(row),
    revenue: formatKopecks(row.revenueKopecks),
    units: units(row.units),
    abcRevenue: row.abcRevenue,
    abcProfit: row.abcProfit,
    abcProfitNote: row.abcProfit ? null : row.abcProfitReason,
    xyz: row.xyz,
    cv: row.cv === null ? '—' : formatShare(row.cv),
  };
}

/** Сводка классов: «12 товаров» и доля показателя. */
export function summaryRows<T extends string>(
  rows: readonly ClassSummary<T>[],
  of: string,
): ClassSummaryRow[] {
  return rows.map((row) => ({
    key: row.key,
    count: `${formatCount(row.skus)} ${plural(row.skus, ['товар', 'товара', 'товаров'])}`,
    share: row.share === null ? '—' : `${formatShare(row.share)} ${of}`,
  }));
}

/** Поиск по названию и артикулу, фильтр по классу ABC выручки и XYZ. */
export function filterClassified(
  rows: readonly RatingSku[],
  filter: { query: string; abc: ClassFilter; xyz: ClassFilter },
): RatingSku[] {
  const needle = filter.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filter.abc === 'all' || row.abcRevenue === filter.abc) &&
      (filter.xyz === 'all' || row.xyz === filter.xyz) &&
      (!needle ||
        row.sku.toLowerCase().includes(needle) ||
        (row.name ?? '').toLowerCase().includes(needle)),
  );
}
