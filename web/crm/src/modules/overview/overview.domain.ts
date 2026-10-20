import type { IUnconfirmedProfit } from '../../../../../src/shared/profit-confirmation';
/**
 * «Обзор» (TASK-125, ТЗ п.1) — главная v2 уровня аккаунта.
 *
 * Деньги, заказы и штуки — из финжурнала тем же расчётом, что «Финансы»
 * (`overview:summary`), поэтому каждая денежная карточка ведёт в «Прибыль»
 * с тем же периодом и показывает там ту же цифру. Остатки, товары в пути и
 * отмены — срезы Маркета по всем магазинам кабинета: в журнале их нет.
 */
import type { IconTone } from '@/modules/dashboard/dashboard.domain';
import type { DayRange } from '@/shared/utils';

export const OVERVIEW_ROUTE_NAME = 'ym-overview';
export const OVERVIEW_SUMMARY_KIND = 'overview:summary';
export const OVERVIEW_STOCKS_KIND = 'overview:stocks';
export const OVERVIEW_CANCELLED_KIND = 'overview:cancelled';
/** Деньги считаются только при открытых «Финансах»: без журнала их нет. */
export const FINANCE_FEATURE = 'finance';

// --- ответы задач ------------------------------------------------------------

export interface PnlLevels {
  revenueKopecks: number;
  otherIncomeKopecks: number;
  cogsKopecks: number;
  grossKopecks: number;
  marketplaceKopecks: number;
  unrecognizedKopecks: number;
  afterMarketplaceKopecks: number;
  operatingExpensesKopecks: number;
  operatingKopecks: number;
  taxKopecks: number;
  netKopecks: number;
  grossMargin: number | null;
  netMargin: number | null;
}

export type ServiceGroup =
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'withholdings'
  | 'otherServices';

export interface OverviewTotals {
  from: string;
  to: string;
  levels: PnlLevels;
  salesKopecks: number;
  returnsKopecks: number;
  services: Record<ServiceGroup, number>;
  ordersCount: number;
  units: number;
  avgCheckKopecks: number | null;
}

export type FinancePeriodStatus = 'preliminary' | 'verified' | 'discrepancy';

export interface SummaryResponse {
  current: OverviewTotals;
  previous: OverviewTotals;
  status: FinancePeriodStatus;
  statusLabel: string;
  /** Признак движка: продажи без закупа — прибыль не подтверждена. */
  unconfirmed: IUnconfirmedProfit;
  taxIsDefault: boolean;
  receivable: { asOf: string; totalKopecks: number; operationCount: number };
}

export interface StoreProblem {
  storeName: string;
  problem: string;
}

export interface StocksResponse {
  takenAt: string;
  stockValueKopecks: number;
  stockUnits: number;
  withoutCost: { skus: number; units: number };
  inTransit: { orders: number; units: number; salesKopecks: number } | null;
  stores: number;
  problems: StoreProblem[];
}

export interface CancelledResponse {
  from: string;
  to: string;
  count: number | null;
  note: string | null;
  stores: number;
  problems: StoreProblem[];
}

/** Запрос задач с периодом: текущий и прошлый (для динамики). */
export interface OverviewRequest {
  range: DayRange;
  previous: DayRange;
}

// --- площадки ---------------------------------------------------------------

/** «Все» или одна площадка. Журнал пока только ЯМ, поэтому «Все» = ЯМ. */
export type MarketplaceFilter = 'all' | 'ym';

export const MARKETPLACE_FILTER_OPTIONS: readonly { value: MarketplaceFilter; label: string }[] = [
  { value: 'all', label: 'Все площадки' },
  { value: 'ym', label: 'Яндекс Маркет' },
];

// --- карточки ---------------------------------------------------------------

export type KpiSource = 'summary' | 'stocks' | 'cancelled';

export type KpiKey =
  | 'revenue'
  | 'orders'
  | 'units'
  | 'avgCheck'
  | 'cogs'
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'tax'
  | 'withholdings'
  | 'returns'
  | 'cancelled'
  | 'gross'
  | 'operating'
  | 'net'
  | 'margin'
  | 'receivable'
  | 'stockValue'
  | 'inTransit';

/** Куда ведёт карточка: «Прибыль» с периодом, ДДС, список магазинов. */
export type KpiLink = 'pnl' | 'cashflow' | 'stores';

export interface KpiMeta {
  key: KpiKey;
  label: string;
  source: KpiSource;
  link: KpiLink;
  iconTone: IconTone;
  accent?: boolean;
}

export interface KpiGroup {
  key: 'sales' | 'costs' | 'profit' | 'money';
  title: string;
  kpis: readonly KpiMeta[];
}

export const KPI_GROUPS: readonly KpiGroup[] = [
  {
    key: 'sales',
    title: 'Продажи',
    kpis: [
      { key: 'revenue', label: 'Выручка', source: 'summary', link: 'pnl', iconTone: 'blue' },
      { key: 'orders', label: 'Заказы', source: 'summary', link: 'pnl', iconTone: 'violet' },
      { key: 'units', label: 'Продано штук', source: 'summary', link: 'pnl', iconTone: 'violet' },
      { key: 'avgCheck', label: 'Средний чек', source: 'summary', link: 'pnl', iconTone: 'blue' },
    ],
  },
  {
    key: 'costs',
    title: 'Расходы',
    kpis: [
      { key: 'cogs', label: 'Себестоимость', source: 'summary', link: 'pnl', iconTone: 'amber' },
      { key: 'commission', label: 'Комиссия', source: 'summary', link: 'pnl', iconTone: 'rose' },
      { key: 'logistics', label: 'Логистика', source: 'summary', link: 'pnl', iconTone: 'rose' },
      { key: 'promotion', label: 'Продвижение', source: 'summary', link: 'pnl', iconTone: 'rose' },
      { key: 'tax', label: 'Налог', source: 'summary', link: 'pnl', iconTone: 'amber' },
      {
        key: 'withholdings',
        label: 'Удержания и штрафы',
        source: 'summary',
        link: 'pnl',
        iconTone: 'danger',
      },
      { key: 'returns', label: 'Возвраты', source: 'summary', link: 'pnl', iconTone: 'danger' },
      {
        key: 'cancelled',
        label: 'Отмены',
        source: 'cancelled',
        link: 'stores',
        iconTone: 'danger',
      },
    ],
  },
  {
    key: 'profit',
    title: 'Прибыль',
    kpis: [
      { key: 'gross', label: 'Валовая прибыль', source: 'summary', link: 'pnl', iconTone: 'ok' },
      {
        key: 'operating',
        label: 'Операционная прибыль',
        source: 'summary',
        link: 'pnl',
        iconTone: 'ok',
      },
      {
        key: 'net',
        label: 'Чистая прибыль',
        source: 'summary',
        link: 'pnl',
        iconTone: 'ok',
        accent: true,
      },
      { key: 'margin', label: 'Рентабельность', source: 'summary', link: 'pnl', iconTone: 'ok' },
    ],
  },
  {
    key: 'money',
    title: 'Деньги и склад',
    kpis: [
      {
        key: 'receivable',
        label: 'К получению',
        source: 'summary',
        link: 'cashflow',
        iconTone: 'blue',
      },
      {
        key: 'stockValue',
        label: 'Стоимость остатков',
        source: 'stocks',
        link: 'stores',
        iconTone: 'violet',
      },
      {
        key: 'inTransit',
        label: 'Товары в пути',
        source: 'stocks',
        link: 'stores',
        iconTone: 'amber',
      },
    ],
  },
];

/** Тон числа карточки — как у KpiCard. */
export type KpiTone = 'neutral' | 'ok' | 'danger';

/** Что карточка показывает: число, подпись (динамика или пояснение), тон. */
export interface KpiView {
  value: string;
  caption: string | null;
  tone: KpiTone;
}

/** Подпись источника срезов Маркета: в журнале их нет (решение overview_counts_from_journal). */
export const MARKET_SOURCE_NOTE = 'из заказов и остатков Маркета, не из журнала';
