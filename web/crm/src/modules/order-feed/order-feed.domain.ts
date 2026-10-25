/**
 * «Лента заказов» (TASK-144, ТЗ п.11): заказы ЯМ, Ozon и WB одним списком —
 * этап, прибыль заказа = Σ его операций журнала − себестоимость, расходы по
 * статьям, история операций. Числа считает сервер; `null` — «нет данных», не
 * ноль. Не путать с модулем `orders` — это отчёты ЯМ по магазину.
 */

import type { ReportPeriod } from '@/shared/period';

export const ORDER_FEED_KIND = 'order-feed:list';
export const FINANCE_FEATURE = 'finance';
export const DEEP_HISTORY_FEATURE = 'deep_history';

/** Строк на странице таблицы. */
export const ORDER_FEED_PAGE_ROWS = 100;

export type OrderFeedMarketplace = 'ym' | 'ozon' | 'wb';

export type OrderStage =
  | 'new'
  | 'awaiting_assembly'
  | 'assembled'
  | 'handed_over'
  | 'in_transit'
  | 'delivered'
  | 'redeemed'
  | 'cancelled'
  | 'returning'
  | 'returned'
  | 'unknown';

/** Почему прибыли нет: операций в журнале ещё нет или у товара нет закупа. */
export type OrderProfitGap = 'no-operations' | 'no-cost';

export type FinanceArticleGroup = 'income' | 'expense' | 'reference' | 'unknown';

export interface OrderFeedArticle {
  article: string;
  title: string;
  group: FinanceArticleGroup;
  kopecks: number;
}

export interface OrderFeedItem {
  sku: string;
  name: string | null;
  count: number;
}

export interface OrderFeedRow {
  marketplace: OrderFeedMarketplace;
  /** Номер для журнала: ЯМ — заказ, Ozon — отправление, WB — srid. */
  id: string;
  /** Номер, который продавец видит в кабинете площадки. */
  orderNumber: string;
  scheme: string | null;
  stage: OrderStage;
  stageLabel: string;
  status: string;
  createdDay: string | null;
  items: OrderFeedItem[];
  /** «Продажи» по данным площадки, рубли; null — площадка не сказала. */
  sales: number | null;
  operations: number;
  operationsKopecks: number | null;
  cogsKopecks: number | null;
  profitKopecks: number | null;
  profitGap: OrderProfitGap | null;
  articles: OrderFeedArticle[];
}

export interface OrderFeedTotals {
  marketplace: OrderFeedMarketplace;
  label: string;
  orders: number;
  withOperations: number;
  profitKopecks: number;
  profitOrders: number;
}

export interface OrderFeedMarketplaceState {
  marketplace: OrderFeedMarketplace;
  label: string;
  state: 'ok' | 'not-connected' | 'failed';
}

export interface OrderFeedProblem {
  marketplace: OrderFeedMarketplace;
  storeName: string | null;
  problem: string;
}

/** Ответ задачи `order-feed:list` как есть. */
export interface OrderFeedResponse {
  /** Площадка экрана (эхо `params.marketplace`, TASK-182); старый ответ без неё — ЯМ. */
  marketplace?: OrderFeedMarketplace;
  period: ReportPeriod;
  periodTitle: string;
  marketplaces: OrderFeedMarketplaceState[];
  stages: { stage: OrderStage; label: string }[];
  totals: OrderFeedTotals[];
  rows: OrderFeedRow[];
  problems: OrderFeedProblem[];
  notes: string[];
}

export interface OrderHistoryOperation {
  id: string;
  accruedDay: string;
  paidDay: string | null;
  article: string;
  serviceName: string | null;
  transactionType: string;
  amountKopecks: number;
  cogsKopecks: number | null;
}

/** Ответ GET истории операций заказа. */
export interface OrderDetailResponse {
  marketplace: OrderFeedMarketplace;
  orderId: string;
  operations: number;
  operationsKopecks: number | null;
  cogsKopecks: number | null;
  profitKopecks: number | null;
  profitGap: OrderProfitGap | null;
  articles: OrderFeedArticle[];
  history: OrderHistoryOperation[];
}

/** Фильтры таблицы; `null` — «все». Живут в query адреса. Площадка — из адреса раздела. */
export interface OrderFeedFilters {
  stage: OrderStage | null;
  /** Поиск товара: артикул или название, без регистра. */
  product: string;
}

export const EMPTY_FILTERS: OrderFeedFilters = { stage: null, product: '' };

export const PROFIT_GAP_TEXT: Record<OrderProfitGap, string> = {
  'no-operations': 'операций в журнале ещё нет',
  'no-cost': 'нет закупа товара',
};
