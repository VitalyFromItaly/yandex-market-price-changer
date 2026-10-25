import type {
  SalesAnalyticsResponse,
  SalesBucket,
  SalesDay,
  SalesFigures,
  SalesKpi,
  SalesMetric,
  SalesPrevious,
  SalesRow,
  SalesSku,
  SkuSort,
  TimeGrain,
  Tone,
} from '../sales-analytics.domain';
import type { BarPoint } from '@/components/ui/chart';

import { fillDays } from '@/components/ui/chart';
import { bucketKey, bucketLabel } from '@/shared/period';
import { deltaCaption, deltaPercent, formatCount, formatKopecks, plural } from '@/shared/utils';

/**
 * Вид «Аналитики продаж» из ответа задачи. Ничего не пересчитывается: недели и
 * месяцы — суммы дней, поэтому Σ корзин = итогу при любом шаге; средний чек и
 * скорость приходят с сервера.
 */

const VELOCITY = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** Ключ корзины — общее правило `shared/period` (тем же группирует дашборд «Площадки»). */
export { bucketKey };

/**
 * Корзины периода: пустые дни — нулями по границам периода (иначе неделя без
 * продаж пропала бы со шкалы), затем сумма дней по шагу. Подпись недели — её
 * дни внутри периода, месяца — «ММ-ГГГГ».
 */
export function bucketsOf(data: SalesAnalyticsResponse, grain: TimeGrain): SalesBucket[] {
  const days = fillDays(
    data.days.map((d) => ({ ...d, date: d.day })),
    data.period.from,
    data.period.to,
    (date) => ({ date, day: date, revenueKopecks: 0, units: 0, orders: 0 }),
  );
  const buckets = new Map<string, SalesBucket & { first: string; last: string }>();
  for (const day of days as (SalesDay & { date: string })[]) {
    const key = bucketKey(day.day, grain);
    const entry = buckets.get(key) ?? {
      key,
      label: '',
      first: day.day,
      last: day.day,
      revenueKopecks: 0,
      units: 0,
      orders: 0,
    };
    entry.revenueKopecks += day.revenueKopecks;
    entry.units += day.units;
    entry.orders += day.orders;
    entry.last = day.day;
    buckets.set(key, entry);
  }
  return [...buckets.values()].map(({ first, last, ...bucket }) => ({
    ...bucket,
    label: bucketLabel(grain, first, last),
  }));
}

const METRIC_VALUE: Record<SalesMetric, (b: SalesBucket) => number> = {
  revenue: (b) => b.revenueKopecks / 100,
  units: (b) => b.units,
  orders: (b) => b.orders,
};

export const METRIC_FORMAT: Record<SalesMetric, (value: number) => string> = {
  revenue: (value) => formatKopecks(Math.round(value * 100)),
  units: (value) => `${formatCount(value)} шт.`,
  orders: (value) => formatCount(value),
};

/** Точки графика одной метрики; тултип называет все три числа корзины. */
export function chartPoints(buckets: readonly SalesBucket[], metric: SalesMetric): BarPoint[] {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    value: METRIC_VALUE[metric](b),
    hint:
      `${b.label}: ${formatKopecks(b.revenueKopecks)} · ` +
      `${formatCount(b.orders)} ${plural(b.orders, ['заказ', 'заказа', 'заказов'])} · ` +
      `${formatCount(b.units)} шт.`,
  }));
}

export const formatVelocity = (perDay: number | null): string =>
  perDay === null ? '—' : `${VELOCITY.format(perDay)} шт./день`;

const formatCheck = (kopecks: number | null): string =>
  kopecks === null ? '—' : formatKopecks(kopecks);

/** Пять карточек итога с динамикой к прошлому периоду. */
export function kpisOf(data: SalesAnalyticsResponse): SalesKpi[] {
  const now = data.totals;
  const before = data.previousTotals;
  const delta = (a: number | null, b: number | null) =>
    a === null || b === null ? null : deltaCaption(a, b);
  return [
    {
      key: 'revenue',
      label: 'Выручка',
      value: formatKopecks(now.revenueKopecks),
      caption: delta(now.revenueKopecks, before.revenueKopecks),
    },
    {
      key: 'orders',
      label: 'Заказы',
      value: formatCount(now.orders),
      caption: delta(now.orders, before.orders),
    },
    {
      key: 'units',
      label: 'Продано, шт.',
      value: formatCount(now.units),
      caption: delta(now.units, before.units),
    },
    {
      key: 'avgCheck',
      label: 'Средний чек',
      value: formatCheck(now.avgCheckKopecks),
      caption:
        now.avgCheckKopecks === null
          ? 'заказов нет'
          : delta(now.avgCheckKopecks, before.avgCheckKopecks),
    },
    {
      key: 'velocity',
      label: 'Скорость продаж',
      value: formatVelocity(now.unitsPerDay),
      caption: delta(now.unitsPerDay, before.unitsPerDay),
    },
  ];
}

function deltaOf(
  revenue: number,
  previous: SalesPrevious | null,
): Pick<SalesRow, 'delta' | 'deltaTone'> {
  const percent = previous ? deltaPercent(revenue, previous.revenueKopecks) : null;
  if (percent === null) return { delta: null, deltaTone: 'muted' };
  let tone: Tone = 'muted';
  if (revenue > (previous as SalesPrevious).revenueKopecks) tone = 'ok';
  else if (revenue < (previous as SalesPrevious).revenueKopecks) tone = 'danger';
  return { delta: percent, deltaTone: tone };
}

/** Строка таблицы любого разреза — одна функция, чтобы колонки значили одно и то же. */
export function toSalesRow(
  key: string,
  title: string,
  subtitle: string | null,
  figures: SalesFigures,
  previous: SalesPrevious | null,
): SalesRow {
  return {
    key,
    title,
    subtitle,
    revenue: formatKopecks(figures.revenueKopecks),
    revenueKopecks: figures.revenueKopecks,
    units: formatCount(figures.units),
    orders: formatCount(figures.orders),
    avgCheck: formatCheck(figures.avgCheckKopecks),
    velocity: formatVelocity(figures.unitsPerDay),
    ...deltaOf(figures.revenueKopecks, previous),
  };
}

export function brandRows(data: SalesAnalyticsResponse): SalesRow[] {
  return data.brands.map((b) =>
    toSalesRow(
      `brand:${b.key ?? ''}`,
      b.title,
      `${formatCount(b.skus)} ${plural(b.skus, ['товар', 'товара', 'товаров'])}`,
      b,
      b.previous,
    ),
  );
}

export function skuRow(sku: SalesSku): SalesRow {
  return toSalesRow(
    `sku:${sku.sku}`,
    sku.name ?? sku.sku,
    sku.name ? sku.sku : null,
    sku,
    sku.previous,
  );
}

export function marketplaceRows(data: SalesAnalyticsResponse): SalesRow[] {
  return data.marketplaces.map((m) =>
    toSalesRow(`mp:${m.marketplace}`, m.label, null, m, m.previous),
  );
}

const SKU_SORT_VALUE: Record<SkuSort, (sku: SalesSku) => number> = {
  revenue: (sku) => sku.revenueKopecks,
  units: (sku) => sku.units,
  velocity: (sku) => sku.unitsPerDay ?? 0,
};

/** Поиск по названию и артикулу, сортировка по убыванию; равные — по артикулу. */
export function filterSkus(skus: readonly SalesSku[], query: string, sort: SkuSort): SalesSku[] {
  const needle = query.trim().toLowerCase();
  const value = SKU_SORT_VALUE[sort];
  return skus
    .filter(
      (sku) =>
        needle === '' ||
        sku.sku.toLowerCase().includes(needle) ||
        (sku.name ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => value(b) - value(a) || a.sku.localeCompare(b.sku));
}
