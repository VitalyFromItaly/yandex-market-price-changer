/**
 * «Рейтинги и классификации» (TASK-141, ТЗ п.9) — ТОП-листы товаров, ABC и XYZ.
 * Чистая функция над двумя готовыми `IPnl` (текущий и прошлый период): числа —
 * из того же `pnlOf`, что «Финансы», «Unit-экономика» и «Аналитика продаж»;
 * здесь только сортировка и классы.
 *
 * - Выручка, чистая, штуки товара — строка разреза `pnl.skus` как есть.
 * - Товар без подтверждённого закупа (`costKnown: false`) в рейтинги прибыли
 *   не входит: его чистая завышена, и место в «самых прибыльных» было бы
 *   выдумкой. В рейтинги выручки и штук он входит — эти числа от закупа не зависят.
 * - Спрос — штуки к прошлому периоду по ОБЪЕДИНЕНИЮ артикулов: товар, проданный
 *   только раньше, — это падение до нуля, а не «нет данных».
 * - XYZ — по штукам артикула за недели (`pnl.skuSalesByDay`, тот же проход
 *   `pnlOf`), недели отсчитываются от начала периода.
 *
 * Все пороги — `RATING_THRESHOLDS`, единственное место; экран печатает их из
 * ответа, своих копий у него нет.
 */

import type { IPnl } from './pnl';
import type { IBrandSource, TBrandKey } from '../yandex/reports/brands';

import { brandOf } from '../yandex/reports/brands';

import { periodDaysOf } from './sales-analytics';

/** Пороги рейтингов и классов. Стартовые — на живых данных не калибровались (known-gaps). */
export const RATING_THRESHOLDS = {
  /** Длина каждого ТОП-листа — по ТЗ. */
  topSize: 20,
  /**
   * ABC — доля накопленного итога ДО товара: меньше `a` — A, меньше `b` — B,
   * иначе C. Классика Парето 80/15/5: товар, на котором итог переходит 80 %,
   * ещё A — без него первые 80 % не набираются.
   */
  abc: { a: 0.8, b: 0.95 },
  /**
   * XYZ — коэффициент вариации недельных продаж (σ / среднее): не выше `x` — X
   * (стабильный спрос), не выше `y` — Y (колеблется), выше — Z (случайный).
   * Классические 10 % / 25 %.
   */
  xyz: { x: 0.1, y: 0.25 },
  /** Неделя — 7 дней от начала периода; неполный хвост отбрасывается: короткая корзина исказила бы вариацию. */
  weekDays: 7,
  /** Меньше четырёх недель — вариация по двум-трём точкам ничего не говорит. */
  minWeeks: 4,
} as const;

export type TAbcClass = 'A' | 'B' | 'C';
export type TXyzClass = 'X' | 'Y' | 'Z';

export type TRatingTopKey = 'revenue' | 'net' | 'units' | 'margin' | 'loss' | 'growing' | 'falling';

export const RATING_TOP_KEYS: readonly TRatingTopKey[] = [
  'revenue',
  'net',
  'units',
  'margin',
  'loss',
  'growing',
  'falling',
];

export const RATING_TOP_TITLE: Record<TRatingTopKey, string> = {
  revenue: 'По выручке',
  net: 'По чистой прибыли',
  units: 'По штукам',
  margin: 'По рентабельности',
  loss: 'Убыточные',
  growing: 'Растущий спрос',
  falling: 'Падающий спрос',
};

/** Почему товара нет в ABC по прибыли. */
export const ABC_PROFIT_NO_COST = 'нет закупа';
export const ABC_PROFIT_NOT_POSITIVE = 'нет прибыли';

export const XYZ_NO_SALES = 'нет продаж';

export interface IRatingSku {
  sku: string;
  /** Название из базы товаров; null — товара в базе нет. */
  name: string | null;
  brand: TBrandKey | null;
  revenueKopecks: number;
  netKopecks: number;
  units: number;
  /** false — у части проданного нет закупа: в рейтинги прибыли не входит. */
  costKnown: boolean;
  /** Чистая / выручка; null — закуп не подтверждён или выручки нет. */
  margin: number | null;
  /** Штуки прошлого периода; null — тогда товар не продавался. */
  previousUnits: number | null;
  /** Штуки сейчас − штуки тогда (не продавался — 0). */
  unitsDelta: number;
  abcRevenue: TAbcClass | null;
  abcProfit: TAbcClass | null;
  /** Почему нет класса по прибыли; null — класс есть. */
  abcProfitReason: string | null;
  xyz: TXyzClass | null;
  /** Коэффициент вариации; null — XYZ не считался или продаж нет. */
  cv: number | null;
  /** Штуки по неделям; пусто — XYZ недоступен в периоде. */
  weeklyUnits: number[];
}

export interface IRatingTop {
  key: TRatingTopKey;
  title: string;
  rows: IRatingSku[];
}

export interface IClassSummary<TClass extends string> {
  key: TClass;
  skus: number;
  /** Σ показателя класса (выручка или чистая), копейки. */
  kopecks: number;
  /** Доля в Σ по классифицированным; null — делить не на что. */
  share: number | null;
}

export interface ISkuRatings {
  thresholds: typeof RATING_THRESHOLDS;
  /** Полных недель в периоде. */
  weeks: number;
  /** Почему XYZ не считался; null — считался. */
  xyzUnavailable: string | null;
  tops: IRatingTop[];
  /** Товары с движением в текущем периоде, по выручке. */
  skus: IRatingSku[];
  abcRevenue: IClassSummary<TAbcClass>[];
  abcProfit: IClassSummary<TAbcClass>[];
  /** Пусто, когда XYZ недоступен. Доля — от выручки товаров с классом. */
  xyz: IClassSummary<TXyzClass>[];
}

const ABC: readonly TAbcClass[] = ['A', 'B', 'C'];
const XYZ: readonly TXyzClass[] = ['X', 'Y', 'Z'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Класс ABC по доле накопленного итога до товара. */
export function abcClassOf(shareBefore: number): TAbcClass {
  const { a, b } = RATING_THRESHOLDS.abc;
  if (shareBefore < a) return 'A';
  if (shareBefore < b) return 'B';
  return 'C';
}

/** ABC по положительным значениям: класс по накопленной доле ДО товара. */
export function abcOf(values: ReadonlyMap<string, number>): Map<string, TAbcClass> {
  const entries = [...values.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const result = new Map<string, TAbcClass>();
  let before = 0;
  for (const [key, value] of entries) {
    result.set(key, abcClassOf(before / total));
    before += value;
  }
  return result;
}

/** Полных недель в периоде (ГГГГ-ММ-ДД включительно). */
export function weeksOf(period: { from: string; to: string }): number {
  return Math.floor(periodDaysOf(period) / RATING_THRESHOLDS.weekDays);
}

/** Номер недели дня от начала периода; null — день в отброшенном хвосте или вне периода. */
export function weekIndexOf(day: string, from: string, weeks: number): number | null {
  const diff = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
  if (!Number.isFinite(diff) || diff < 0) return null;
  const index = Math.floor(diff / RATING_THRESHOLDS.weekDays);
  return index < weeks ? index : null;
}

/** Коэффициент вариации (σ популяционная / среднее); null — среднее ≤ 0. */
export function variationOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (!(mean > 0)) return null;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function xyzOf(cv: number): TXyzClass {
  const { x, y } = RATING_THRESHOLDS.xyz;
  if (cv <= x) return 'X';
  if (cv <= y) return 'Y';
  return 'Z';
}

function summaryOf<TClass extends string>(
  keys: readonly TClass[],
  rows: readonly IRatingSku[],
  classOf: (row: IRatingSku) => TClass | null,
  valueOf: (row: IRatingSku) => number,
): IClassSummary<TClass>[] {
  const totals = new Map<TClass, { skus: number; kopecks: number }>();
  let all = 0;
  for (const row of rows) {
    const key = classOf(row);
    if (!key) continue;
    const entry = totals.get(key) ?? { skus: 0, kopecks: 0 };
    entry.skus += 1;
    entry.kopecks += valueOf(row);
    totals.set(key, entry);
    all += valueOf(row);
  }
  return keys.map((key) => {
    const entry = totals.get(key) ?? { skus: 0, kopecks: 0 };
    return { key, ...entry, share: all > 0 ? entry.kopecks / all : null };
  });
}

const profitReasonOf = (costKnown: boolean) =>
  costKnown ? ABC_PROFIT_NOT_POSITIVE : ABC_PROFIT_NO_COST;

const bySku = (a: IRatingSku, b: IRatingSku) => a.sku.localeCompare(b.sku);

function topOf(
  rows: readonly IRatingSku[],
  keep: (row: IRatingSku) => boolean,
  compare: (a: IRatingSku, b: IRatingSku) => number,
): IRatingSku[] {
  return rows
    .filter(keep)
    .sort((a, b) => compare(a, b) || bySku(a, b))
    .slice(0, RATING_THRESHOLDS.topSize);
}

/** Рейтинги периода. `products` — название и категория по артикулу ЯМ. */
export function skuRatingsOf(
  current: IPnl,
  previous: IPnl,
  products: ReadonlyMap<string, IBrandSource>,
): ISkuRatings {
  const weeks = weeksOf(current.period);
  const xyzUnavailable =
    weeks < RATING_THRESHOLDS.minWeeks
      ? `XYZ считается по неделям: нужен период от ${RATING_THRESHOLDS.minWeeks} полных недель`
      : null;

  const weekly = new Map<string, number[]>();
  if (!xyzUnavailable) {
    for (const cell of current.skuSalesByDay) {
      const index = weekIndexOf(cell.day, current.period.from, weeks);
      if (index === null) continue;
      const series = weekly.get(cell.sku) ?? new Array<number>(weeks).fill(0);
      series[index] += cell.units;
      weekly.set(cell.sku, series);
    }
  }

  const previousUnits = new Map(previous.skus.skus.map((row) => [row.sku, row.units]));
  const describe = (sku: string) => {
    const product = products.get(sku);
    return { name: product?.name || null, brand: product ? brandOf(product) : null };
  };

  const abcRevenue = abcOf(new Map(current.skus.skus.map((row) => [row.sku, row.columns.revenue])));
  const abcProfit = abcOf(
    new Map(
      current.skus.skus.filter((row) => row.costKnown).map((row) => [row.sku, row.netKopecks]),
    ),
  );

  const skus: IRatingSku[] = current.skus.skus
    .map((row): IRatingSku => {
      const before = previousUnits.get(row.sku);
      const revenue = row.columns.revenue;
      let xyz: TXyzClass | null = null;
      let cv: number | null = null;
      const series = xyzUnavailable
        ? []
        : (weekly.get(row.sku) ?? new Array<number>(weeks).fill(0));
      if (!xyzUnavailable) {
        cv = variationOf(series);
        xyz = cv === null ? null : xyzOf(cv);
      }
      const profitClass = abcProfit.get(row.sku) ?? null;
      return {
        sku: row.sku,
        ...describe(row.sku),
        revenueKopecks: revenue,
        netKopecks: row.netKopecks,
        units: row.units,
        costKnown: row.costKnown,
        margin: row.costKnown && revenue > 0 ? row.netKopecks / revenue : null,
        previousUnits: before ?? null,
        unitsDelta: row.units - (before ?? 0),
        abcRevenue: abcRevenue.get(row.sku) ?? null,
        abcProfit: profitClass,
        abcProfitReason: profitClass ? null : profitReasonOf(row.costKnown),
        xyz,
        cv,
        weeklyUnits: series,
      };
    })
    .sort((a, b) => b.revenueKopecks - a.revenueKopecks || bySku(a, b));

  // Проданные только в прошлом периоде — для «падающего спроса»: падение до нуля.
  const present = new Set(skus.map((row) => row.sku));
  const gone: IRatingSku[] = previous.skus.skus
    .filter((row) => !present.has(row.sku))
    .map((row) => ({
      sku: row.sku,
      ...describe(row.sku),
      revenueKopecks: 0,
      netKopecks: 0,
      units: 0,
      costKnown: true,
      margin: null,
      previousUnits: row.units,
      unitsDelta: -row.units,
      abcRevenue: null,
      abcProfit: null,
      abcProfitReason: ABC_PROFIT_NOT_POSITIVE,
      xyz: null,
      cv: null,
      weeklyUnits: [],
    }));
  const withGone = [...skus, ...gone];

  const lists: Record<TRatingTopKey, IRatingSku[]> = {
    revenue: topOf(
      skus,
      (r) => r.revenueKopecks > 0,
      (a, b) => b.revenueKopecks - a.revenueKopecks,
    ),
    net: topOf(
      skus,
      (r) => r.costKnown && r.netKopecks > 0,
      (a, b) => b.netKopecks - a.netKopecks,
    ),
    units: topOf(
      skus,
      (r) => r.units > 0,
      (a, b) => b.units - a.units,
    ),
    margin: topOf(
      skus,
      (r) => r.margin !== null,
      (a, b) => (b.margin ?? 0) - (a.margin ?? 0),
    ),
    loss: topOf(
      skus,
      (r) => r.costKnown && r.netKopecks < 0,
      (a, b) => a.netKopecks - b.netKopecks,
    ),
    growing: topOf(
      withGone,
      (r) => r.unitsDelta > 0,
      (a, b) => b.unitsDelta - a.unitsDelta,
    ),
    falling: topOf(
      withGone,
      (r) => r.unitsDelta < 0,
      (a, b) => a.unitsDelta - b.unitsDelta,
    ),
  };
  const tops: IRatingTop[] = RATING_TOP_KEYS.map((key) => ({
    key,
    title: RATING_TOP_TITLE[key],
    rows: lists[key],
  }));

  return {
    thresholds: RATING_THRESHOLDS,
    weeks,
    xyzUnavailable,
    tops,
    skus,
    abcRevenue: summaryOf(
      ABC,
      skus,
      (r) => r.abcRevenue,
      (r) => r.revenueKopecks,
    ),
    abcProfit: summaryOf(
      ABC,
      skus,
      (r) => r.abcProfit,
      (r) => r.netKopecks,
    ),
    xyz: xyzUnavailable
      ? []
      : summaryOf(
          XYZ,
          skus,
          (r) => r.xyz,
          (r) => r.revenueKopecks,
        ),
  };
}
