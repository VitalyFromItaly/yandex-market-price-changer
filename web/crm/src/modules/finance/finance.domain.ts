import type { FinanceMarketplace } from './constants/marketplaces.finance';
import type { IUnconfirmedProfit } from '../../../../../src/shared/profit-confirmation';

export type { FinanceMarketplace, FinanceUnsupported } from './constants/marketplaces.finance';
/**
 * Раздел «Финансы» (TASK-124): P&L месяца из журнала операций Маркета —
 * уровни прибыли, статьи с раскрытием до операций и оригинала отчёта; ДДС
 * (переехал из «Закупок»); статус периода, расхождения сверки и корректировки.
 * Всё считает сервер; фронт только показывает.
 */

export type FinancePeriodStatus = 'preliminary' | 'verified' | 'discrepancy';

/** Месяц выбора — ответ `/ym/finance/months`. */
export interface FinanceMonth {
  /** «ГГГГ-ММ». */
  month: string;
  from: string;
  to: string;
  /** null — журнал за месяц не загружался. */
  status: FinancePeriodStatus | null;
  statusLabel: string;
  discrepancyCount: number;
  changedCount: number;
  removedCount: number;
  unknownCount: number;
  reconcileNote: string | null;
  checkedAt: string | null;
}

export type PnlSectionKey =
  | 'revenue'
  | 'other_income'
  | 'marketplace'
  | 'unrecognized'
  | 'reference';

export interface PnlArticle {
  article: string;
  title: string;
  kopecks: number;
  /** Ровно те операции, что сложились в `kopecks`. */
  operationIds: string[];
}

export interface PnlSection {
  key: PnlSectionKey;
  title: string;
  kopecks: number;
  articles: PnlArticle[];
}

export interface PnlFlatEstimate {
  label: string;
  block: 'placed' | 'redeemed';
  /** Рубли — плоская формула «Прибыли». */
  revenue: number;
  commission: number;
  tax: number;
  promo: number;
  purchase: number;
  net: number;
  orders: number;
}

/**
 * Запрос P&L: месяц из списка или произвольный период из ссылки «Обзора»
 * (решение `finance_pnl_range`). ДДС и сверка остаются помесячными.
 */
/** `marketplace` — чей журнал (TASK-137); нет — ЯМ. */
export type PnlRequest = ({ month: string } | { from: string; to: string }) & {
  marketplace?: FinanceMarketplace;
};

/** Результат задачи `finance:pnl`. */
export interface PnlResponse {
  /** Эхо месяца; null — произвольный период (ссылка с «Обзора»), эхо — from/to. */
  month: string | null;
  /** Эхо площадки; нет у результатов до TASK-137 — ЯМ. */
  marketplace?: FinanceMarketplace;
  from: string;
  to: string;
  status: FinancePeriodStatus;
  statusLabel: string;
  /** Признак движка: продажи без закупа — прибыль не подтверждена. */
  unconfirmed: IUnconfirmedProfit;
  taxIsDefault: boolean;
  levels: {
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
  };
  sections: PnlSection[];
  tax: { incomeKopecks: number; minimumApplied: boolean; undatedLines: number };
  flat: PnlFlatEstimate | null;
  flatNote: string | null;
}

export interface FinanceDiscrepancy {
  kind: string;
  kindLabel: string;
  orderId: string | null;
  bankOrderId: string | null;
  operationIds: string[];
  operationCount: number;
  expectedKopecks: number | null;
  actualKopecks: number | null;
  detail: string | null;
}

export interface FinanceAnomaly {
  key: string;
  kind: string;
  kindLabel: string;
  threshold: string;
  detail: string;
  amountKopecks: number | null;
  sku: string | null;
  orderId: string | null;
  operationIds: string[];
  operationCount: number;
  reviewed: boolean;
}

export interface FinanceAnomalies {
  total: number;
  /** Непросмотренных в месяце — независимо от фильтра. */
  unreviewed: number;
  /** ISO; null — детектор месяц не проверял. */
  checkedAt: string | null;
  items: FinanceAnomaly[];
}

export interface FinanceCorrectionSide {
  amountKopecks: number;
  accruedAt: string;
  article: string;
  articleTitle: string;
  transactionType: string;
  serviceName: string | null;
  orderId: string | null;
  sku: string | null;
}

export interface FinanceCorrection {
  kind: 'changed' | 'removed';
  documentVersion: number;
  before: FinanceCorrectionSide;
  after: FinanceCorrectionSide | null;
  createdAt: string;
}

export interface FinancePage<T> {
  total: number;
  items: T[];
}

export interface Payout {
  bankOrderId: string | null;
  day: string;
  kopecks: number;
  linesKopecks: number;
  operationCount: number;
  mismatch: boolean;
}

export interface Cashflow {
  from: string;
  to: string;
  inflow: { payoutsKopecks: number; totalKopecks: number };
  outflow: {
    purchasesKopecks: number;
    expensesKopecks: number;
    expensesByCategory: { key: string; label: string; kopecks: number }[];
    taxesKopecks: number;
    totalKopecks: number;
  };
  netKopecks: number;
  payouts: Payout[];
  receivable: {
    asOf: string;
    totalKopecks: number;
    operationCount: number;
    byArticle: { article: string; label: string; kopecks: number; operationCount: number }[];
  };
}

// ── Модели экрана ──────────────────────────────────────────────

export type StatusTone = 'ok' | 'warn' | 'danger' | 'default';

export interface MonthOption {
  value: string;
  /** «Сентябрь 2026». */
  label: string;
  statusLabel: string;
  tone: StatusTone;
}

export interface MonthStatusModel {
  label: string;
  statusLabel: string;
  tone: StatusTone;
  /** Что известно о месяце: загрузка, сверка, корректировки. */
  lines: string[];
}

export interface PnlLevelRow {
  key: string;
  label: string;
  amount: string;
  /** Итог уровня — жирным, слагаемое — с отступом. */
  total: boolean;
  negative: boolean;
}

export interface PnlArticleRow {
  article: string;
  title: string;
  amount: string;
  negative: boolean;
  /** «12 операций». */
  countLabel: string;
  operationIds: string[];
}

export interface PnlSectionModel {
  key: PnlSectionKey;
  title: string;
  amount: string;
  /** Справочный раздел в прибыль не входит. */
  reference: boolean;
  articles: PnlArticleRow[];
}

export interface PnlModel {
  month: string | null;
  rangeLabel: string;
  statusLabel: string;
  tone: StatusTone;
  /** Непроверенный период — числа могут поменяться. */
  preliminary: boolean;
  levels: PnlLevelRow[];
  net: string;
  netNegative: boolean;
  netMargin: string | null;
  sections: PnlSectionModel[];
  /** Пояснения под цифрами: нет закупа, налог по умолчанию, плоская оценка не построена. */
  notes: string[];
  flat: {
    label: string;
    rows: { key: string; label: string; amount: string }[];
    net: string;
  } | null;
}

export interface DiscrepancyRow {
  key: string;
  label: string;
  reference: string | null;
  detail: string | null;
  expected: string | null;
  actual: string | null;
  operations: string;
}

export interface AnomalyRow {
  key: string;
  label: string;
  detail: string;
  threshold: string;
  reference: string | null;
  amount: string | null;
  operations: string;
  operationIds: string[];
  reviewed: boolean;
}

export interface AnomaliesModel {
  rows: AnomalyRow[];
  total: number;
  unreviewed: number;
  /** «Проверено 12.10.2026»; null — месяц детектор не видел. */
  checkedLabel: string | null;
}

export type AnomalyFilter = 'new' | 'all';

export interface CorrectionRow {
  key: string;
  kindLabel: string;
  what: string;
  before: string;
  after: string | null;
  version: string;
}

export interface CashflowLine {
  key: string;
  label: string;
  amount: string;
  children?: { key: string; label: string; amount: string }[];
}

export interface CashflowModel {
  rangeLabel: string;
  inflow: CashflowLine[];
  inflowTotal: string;
  outflow: CashflowLine[];
  outflowTotal: string;
  net: string;
  netNegative: boolean;
  payouts: { key: string; day: string; order: string; amount: string; mismatch: boolean }[];
  receivable: {
    asOf: string;
    total: string;
    isEmpty: boolean;
    byArticle: { key: string; label: string; amount: string }[];
  };
}

// ── Константы ─────────────────────────────────────────────────

export const FINANCE_PNL_KIND = 'finance:pnl';

export interface FinanceTabMeta {
  key: 'pnl' | 'cashflow' | 'audit' | 'anomalies' | 'upload';
  label: string;
  /** Своя фича вкладки; нет — вкладку открывает фича раздела. */
  feature?: string;
}

// ── Ручная загрузка отчёта (TASK-114) ─────────────────────────

/** Ответ `POST /ym/finance/upload`. */
export type FinanceUploadResponse =
  | { status: 'unchanged'; month: string; rows: number }
  | {
      status: 'imported';
      month: string;
      documentId: string;
      rows: number;
      inserted: number;
      matched: number;
      skippedSuperseded: number;
      unknown: number;
    };

/** Итог загрузки для экрана: заголовок и строки пояснений. */
export interface FinanceUploadSummary {
  title: string;
  lines: string[];
}

/** Куда поставить отказ: под полем файла, над формой; `missing` — не найденные колонки. */
export interface FinanceUploadErrors {
  file: string | null;
  form: string | null;
  missing: string[];
}

export const ANOMALY_FILTERS: readonly { value: AnomalyFilter; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'all', label: 'Все' },
];

/** Строк расхождений и корректировок на странице. */
export const AUDIT_PAGE_SIZE = 50;

/** Аномалий на странице; сервер отмечает до 100 ключей за раз. */
export const ANOMALIES_PAGE_SIZE = 50;
