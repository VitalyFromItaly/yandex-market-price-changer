/**
 * «Аналитика возвратов» (TASK-145, ТЗ п.11) — возвраты за период: штуки и
 * заказы, % от выкупов, сумма возвращённых товаров, обратная логистика,
 * удержания, невозвращённые комиссии и потери — по брендам, товарам и
 * площадкам. Раздел уровня аккаунта.
 *
 * Числа — из финансового журнала каждой площадки (`returns-analytics:summary`),
 * по дню начисления; возвраты «в пути» — в отчёте «Едет обратно». Площадки не
 * складываются: экран показывает выбранную, разрез «Площадки» — строки без
 * итога (решение `returns_marketplace_switch`).
 */
import type { DayRange } from '@/shared/utils';

export const RETURNS_ANALYTICS_ROUTE_NAME = 'ym-returns-analytics';
export const RETURNS_ANALYTICS_KIND = 'returns-analytics:summary';
/** Без «Финансов» журнала нет: задача получила бы 403 гейта. */
export const FINANCE_FEATURE = 'finance';

// --- ответ задачи ------------------------------------------------------------

export interface ReturnFigures {
  returnedUnits: number;
  returnedOrders: number;
  soldUnits: number;
  /** Вернулось / выкуплено; null — выкупов нет. */
  returnRate: number | null;
  returnedAmountKopecks: number;
  reverseLogisticsKopecks: number;
  withholdingsKopecks: number;
  compensationsKopecks: number;
  unreturnedCommissionKopecks: number;
  lossesKopecks: number;
}

export interface ReturnSku extends ReturnFigures {
  sku: string;
  name: string | null;
  brand: string | null;
}

export interface ReturnBrand extends ReturnFigures {
  key: string | null;
  title: string;
  skus: number;
}

export interface ReturnsMarketplace {
  marketplace: string;
  label: string;
  period: DayRange;
  totals: ReturnFigures;
  skus: ReturnSku[];
  brands: ReturnBrand[];
  rest: ReturnFigures;
}

export interface ReturnsAnalyticsResponse {
  period: DayRange;
  marketplaces: ReturnsMarketplace[];
  problems: { marketplace: string; problem: string }[];
  notes: string[];
}

// --- вид -----------------------------------------------------------------------

export type ReturnsSlice = 'brand' | 'sku' | 'marketplace';

export const RETURNS_SLICE_OPTIONS: { value: ReturnsSlice; label: string }[] = [
  { value: 'brand', label: 'По брендам' },
  { value: 'sku', label: 'По товарам' },
  { value: 'marketplace', label: 'По площадкам' },
];

export interface ReturnsKpi {
  key: 'units' | 'rate' | 'amount' | 'logistics' | 'losses';
  label: string;
  value: string;
  caption: string | null;
}

/** Строка таблицы разреза (бренд, товар, площадка, «не отнесено», итог). */
export interface ReturnsRow {
  key: string;
  title: string;
  subtitle: string | null;
  units: string;
  orders: string;
  rate: string;
  amount: string;
  logistics: string;
  withholdings: string;
  commission: string;
  compensations: string;
  losses: string;
  lossesKopecks: number;
}

export const REST_TITLE = 'Не отнесено к товару';

export const REST_NOTE =
  'Строки без артикула — сводные услуги и операции на несколько товаров — площадка не относит ' +
  'к товару. С этой строкой сумма по брендам и товарам равна итогу.';

export const LOSSES_HINT =
  'Потери = обратная логистика + удержания + невозвращённые комиссии − компенсации. ' +
  'Невозвращённая комиссия — комиссия возвращённого заказа за все даты минус то, что площадка вернула.';

export const RATE_HINT =
  'Процент — вернувшиеся штуки к выкупленным за тот же период по журналу; возвращают и купленное ' +
  'раньше, поэтому у товара он бывает выше 100 %.';
