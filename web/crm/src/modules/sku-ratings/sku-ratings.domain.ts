import type { IUnconfirmedProfit } from '../../../../../src/shared/profit-confirmation';
/**
 * «Рейтинги и классификации» (TASK-141, ТЗ п.9) — ТОП-20 товаров по выручке,
 * прибыли, штукам и рентабельности, убыточные, растущий и падающий спрос, классы
 * ABC и XYZ. Раздел уровня аккаунта.
 *
 * Числа — тот же P&L, что «Финансы» (`sku-ratings:summary` поверх
 * `FinanceService.build`). Пороги классов приходят в ответе: экран их печатает,
 * своих копий у него нет.
 */
import type { MarketplaceKey } from '@/navigation.sections';
import type { DayRange } from '@/shared/utils';

export const SKU_RATINGS_KIND = 'sku-ratings:summary';
/** Без «Финансов» рейтингов из журнала нет: задача получила бы 403 гейта. */
export const FINANCE_FEATURE = 'finance';

// --- ответ задачи ------------------------------------------------------------

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export type RatingTopKey = 'revenue' | 'net' | 'units' | 'margin' | 'loss' | 'growing' | 'falling';

export interface RatingThresholds {
  topSize: number;
  abc: { a: number; b: number };
  xyz: { x: number; y: number };
  weekDays: number;
  minWeeks: number;
}

export interface RatingSku {
  sku: string;
  name: string | null;
  brand: string | null;
  revenueKopecks: number;
  netKopecks: number;
  units: number;
  costKnown: boolean;
  margin: number | null;
  previousUnits: number | null;
  unitsDelta: number;
  abcRevenue: AbcClass | null;
  abcProfit: AbcClass | null;
  abcProfitReason: string | null;
  xyz: XyzClass | null;
  cv: number | null;
  weeklyUnits: number[];
}

export interface RatingTop {
  key: RatingTopKey;
  title: string;
  rows: RatingSku[];
}

export interface ClassSummary<T extends string> {
  key: T;
  skus: number;
  kopecks: number;
  share: number | null;
}

export interface SkuRatingsResponse {
  /** Площадка журнала (TASK-181) — эхо запроса; старый ответ без неё — ЯМ. */
  marketplace?: MarketplaceKey;
  period: DayRange;
  previousPeriod: DayRange;
  status: 'preliminary' | 'final' | 'verified' | 'discrepancy';
  statusLabel: string;
  thresholds: RatingThresholds;
  weeks: number;
  xyzUnavailable: string | null;
  tops: RatingTop[];
  skus: RatingSku[];
  abcRevenue: ClassSummary<AbcClass>[];
  abcProfit: ClassSummary<AbcClass>[];
  xyz: ClassSummary<XyzClass>[];
  unconfirmed: IUnconfirmedProfit;
}

export interface RatingsRequest {
  range: DayRange;
  previous: DayRange;
}

// --- вид -----------------------------------------------------------------------

export type Tone = 'ok' | 'danger' | 'muted';

/** Главное число строки ТОП-листа — то, по которому лист отсортирован. */
export type TopMetric = 'revenue' | 'net' | 'units' | 'margin' | 'demand';

export const TOP_METRIC: Record<RatingTopKey, TopMetric> = {
  revenue: 'revenue',
  net: 'net',
  units: 'units',
  margin: 'margin',
  loss: 'net',
  growing: 'demand',
  falling: 'demand',
};

/** Строка ТОП-листа. */
export interface TopRow {
  key: string;
  place: number;
  title: string;
  /** Артикул под названием; null — названия нет, артикул и есть заголовок. */
  subtitle: string | null;
  revenue: string;
  net: string;
  units: string;
  margin: string;
  /** «3 → 5 шт.», «новый», «5 → 0 шт.». */
  demand: string;
  demandTone: Tone;
}

/** Строка таблицы классов. */
export interface ClassRow {
  key: string;
  title: string;
  subtitle: string | null;
  revenue: string;
  units: string;
  abcRevenue: AbcClass | null;
  abcProfit: AbcClass | null;
  /** Почему нет класса по прибыли: «нет закупа», «нет прибыли». */
  abcProfitNote: string | null;
  xyz: XyzClass | null;
  /** Коэффициент вариации в процентах; «—» — не считался. */
  cv: string;
}

/** Строка сводки класса: «A · 12 товаров · 78 % выручки». */
export interface ClassSummaryRow {
  key: string;
  count: string;
  share: string;
}

export type ClassFilter = 'all' | AbcClass | XyzClass;

export const ABC_FILTER_OPTIONS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
];

export const XYZ_FILTER_OPTIONS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'X', label: 'X' },
  { value: 'Y', label: 'Y' },
  { value: 'Z', label: 'Z' },
];

export const NO_COST_NOTE =
  'Товары без закупочной цены не входят в рейтинги прибыли и рентабельности и в ABC по прибыли: ' +
  'их прибыль завышена. В рейтинги выручки, штук и спроса они входят.';

export const DEMAND_NOTE =
  'Спрос — штуки к прошлому периоду той же длины. Товар, который тогда продавался, а сейчас нет, — ' +
  'падение до нуля.';
