import type { RangeWithPrevious } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

/** «Сравнение площадок» (TASK-137): ЯМ, Ozon и WB за один период рядом. */

export const MARKETPLACE_COMPARE_ROUTE_NAME = 'ym-marketplace-compare';
export const MARKETPLACE_COMPARE_KIND = 'marketplace-compare:summary';
export const FINANCE_FEATURE = 'finance';

export type CompareMarketplace = 'ym' | 'ozon' | 'wb';
export type CompareColumnState = 'ok' | 'closed' | 'no-journal';
export type ComparePeriodStatus = 'preliminary' | 'verified' | 'discrepancy';

export type ServiceGroup =
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'withholdings'
  | 'otherServices';

/** Показатели колонки — ответ сервера как есть, деньги в копейках. */
export interface CompareMetrics {
  revenueKopecks: number;
  salesKopecks: number;
  returnsKopecks: number;
  returnsShare: number | null;
  orders: number;
  units: number;
  avgCheckKopecks: number | null;
  services: Record<ServiceGroup, number>;
  commissionShare: number | null;
  marketplaceKopecks: number;
  costShare: number | null;
  cogsKopecks: number;
  operatingExpensesKopecks: number;
  taxKopecks: number;
  netKopecks: number;
  netMargin: number | null;
  netPerOrderKopecks: number | null;
  costComplete: boolean;
}

export interface CompareScheme {
  marketplace: CompareMarketplace;
  scheme: string;
  revenueKopecks: number;
  netKopecks: number;
  margin: number | null;
}

export interface CompareColumn {
  marketplace: CompareMarketplace;
  label: string;
  state: CompareColumnState;
  reason: string | null;
  status: ComparePeriodStatus | null;
  statusLabel: string | null;
  verified: boolean;
  metrics: CompareMetrics | null;
  previous: CompareMetrics | null;
  schemes: CompareScheme[];
}

export type ConclusionKind =
  | 'revenue'
  | 'net_per_order'
  | 'cost_share'
  | 'returns'
  | 'growth'
  | 'scheme'
  | 'product';

export interface CompareProductWin {
  sku: string;
  winner: CompareMarketplace;
  runnerUp: CompareMarketplace;
  winnerPerUnitKopecks: number;
  runnerUpPerUnitKopecks: number;
}

export interface CompareConclusion {
  kind: ConclusionKind;
  title: string;
  winner: CompareMarketplace | null;
  text: string | null;
  reason: string | null;
  scheme?: string;
  products?: CompareProductWin[];
}

export interface MarketplaceCompareResponse {
  period: DayRange;
  previousPeriod: DayRange;
  columns: CompareColumn[];
  conclusions: CompareConclusion[];
  notes: string[];
  operatingExpensesKopecks: number;
  taxIsDefault: boolean;
}

/** Период и прошлый период — общий тип экранов сравнения (`useRangeWithPrevious`). */
export type CompareRequest = RangeWithPrevious;

/** Строка таблицы: что показать и как форматировать. */
export type MetricFormat = 'money' | 'count' | 'share';

export interface CompareMetricDef {
  key: string;
  label: string;
  format: MetricFormat;
  /** Вынуть значение из показателей колонки; null — «—». */
  pick: (metrics: CompareMetrics) => number | null;
  /** Строка — итог уровня, выделяется. */
  strong?: boolean;
}

/** Таблица ТЗ п.2: порядок строк — от денег к результату. */
export const COMPARE_METRICS: readonly CompareMetricDef[] = [
  {
    key: 'revenue',
    label: 'Выручка',
    format: 'money',
    pick: (m) => m.revenueKopecks,
    strong: true,
  },
  { key: 'orders', label: 'Заказы с продажей', format: 'count', pick: (m) => m.orders },
  { key: 'units', label: 'Выкуплено, шт.', format: 'count', pick: (m) => m.units },
  { key: 'avgCheck', label: 'Средний чек', format: 'money', pick: (m) => m.avgCheckKopecks },
  { key: 'commission', label: 'Комиссия', format: 'money', pick: (m) => m.services.commission },
  {
    key: 'commissionShare',
    label: 'Комиссия, % выручки',
    format: 'share',
    pick: (m) => m.commissionShare,
  },
  { key: 'logistics', label: 'Логистика', format: 'money', pick: (m) => m.services.logistics },
  { key: 'promotion', label: 'Реклама', format: 'money', pick: (m) => m.services.promotion },
  {
    key: 'other',
    label: 'Прочие услуги и удержания',
    format: 'money',
    pick: (m) => m.services.otherServices + m.services.withholdings,
  },
  {
    key: 'costShare',
    label: 'Услуги площадки, % выручки',
    format: 'share',
    pick: (m) => m.costShare,
  },
  { key: 'cogs', label: 'Себестоимость', format: 'money', pick: (m) => -m.cogsKopecks },
  {
    key: 'opex',
    label: 'Операционные расходы (доля)',
    format: 'money',
    pick: (m) => -m.operatingExpensesKopecks,
  },
  { key: 'tax', label: 'Налог', format: 'money', pick: (m) => -m.taxKopecks },
  {
    key: 'returnsShare',
    label: 'Возвраты, % продаж',
    format: 'share',
    pick: (m) => m.returnsShare,
  },
  { key: 'net', label: 'Чистая прибыль', format: 'money', pick: (m) => m.netKopecks, strong: true },
  {
    key: 'netMargin',
    label: 'Рентабельность',
    format: 'share',
    pick: (m) => m.netMargin,
    strong: true,
  },
];
