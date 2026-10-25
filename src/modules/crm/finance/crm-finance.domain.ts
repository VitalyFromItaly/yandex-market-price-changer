import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type { IFinanceAnomalyRow } from '../../../database/postgres/repositories/finance-anomaly.repository';
import type { TFinanceCorrectionRow } from '../../../database/postgres/repositories/finance-correction.repository';
import type { TFinanceDiscrepancyRow } from '../../../database/postgres/repositories/finance-discrepancy.repository';
import type { IUnconfirmedProfit } from '../../../shared/profit-confirmation';
import type { IPayout } from '../../finance/cashflow';
import type { TFinanceArticle } from '../../finance/finance-articles';
import type { ICashflowReport } from '../../finance/finance-cashflow.service';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TFinancePeriodStatus } from '../../finance/finance-period-status';
import type { IFinanceScreenMonth, IFinanceScreenOperation } from '../../finance/finance-screen';
import type { IFinanceScreenMonthState } from '../../finance/finance-screen.service';
import type { IPnlFlatEstimate, IPnlReport } from '../../finance/finance.service';
import type { TPnlSection } from '../../finance/pnl';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { ANOMALY_KIND_LABEL } from '../../finance/finance-anomalies';
import { FINANCE_ARTICLE_KEYS, FINANCE_ARTICLE_META } from '../../finance/finance-articles';
import { parseDayRange } from '../../finance/finance-period';
import { FINANCE_PERIOD_STATUS_LABEL } from '../../finance/finance-period-status';
import { RECONCILE_KIND_LABEL } from '../../finance/finance-reconcile';
import { parseScreenMonth } from '../../finance/finance-screen';
import { breakdownOf, expandBreakdown } from '../../finance/operation-breakdown';
import { PNL_SECTION, PNL_SECTION_ORDER, PNL_SECTION_TITLE } from '../../finance/pnl';
import { isMarketplaceFeatureOpen } from '../../marketplaces/marketplace-connections.domain';

/**
 * Раздел «Финансы» CRM (TASK-124): вид для фронта. Числа считают
 * `FinanceService` (P&L), `FinanceCashflowService` (ДДС) и
 * `FinanceScreenService`; здесь только сборка ответа перечислением полей —
 * сырая строка отчёта и `telegramUserId` наружу не уходят.
 */

/** 400: запрос не принят; `field` — под каким полем показать ошибку. */
export const INVALID_FINANCE_REQUEST = 'INVALID_FINANCE_REQUEST';
/** 404: оригинала нет, он чужой или не сохранён. */
export const FINANCE_DOCUMENT_NOT_FOUND = 'FINANCE_DOCUMENT_NOT_FOUND';
export const FINANCE_DOCUMENT_NOT_FOUND_TEXT =
  'Оригинал отчёта не найден: версия удалена или файл был больше 15 МБ и не сохранялся.';

/** Ручная загрузка отчёта (TASK-114): файл не распознан — в ответе `missing`, подписи колонок. */
export const FINANCE_FILE_UNRECOGNIZED = 'FINANCE_FILE_UNRECOGNIZED';
/** Загружен отчёт об услугах, а не по платежам (решение `finance_upload_netting_only`). */
export const FINANCE_FILE_WRONG_REPORT = 'FINANCE_FILE_WRONG_REPORT';
/** Строка с битой датой или суммой — в ответе её номер `row`. */
export const FINANCE_FILE_BAD_ROW = 'FINANCE_FILE_BAD_ROW';
/** 409: тот же месяц сейчас загружается другим путём. */
export const FINANCE_IMPORT_BUSY = 'FINANCE_IMPORT_BUSY';
/** 409: магазин не подключён — журналу не к чему относиться. */
export const FINANCE_NO_STORE = 'NO_STORE';

export const FINANCE_UPLOAD_EXTENSIONS = ['xlsx', 'xls', 'csv'] as const;
export const FINANCE_UPLOAD_NO_FILE_TEXT =
  'Выберите файл отчёта Маркета по платежам (.xlsx, .xls или .csv).';
export const FINANCE_UPLOAD_BAD_EXTENSION_TEXT =
  'Нужен файл .xlsx, .xls или .csv — отчёт по платежам из кабинета Маркета.';
export const FINANCE_UPLOAD_TOO_LARGE_TEXT = 'Файл больше 15 МБ — такой отчёт мы не примем.';
export const FINANCE_UPLOAD_MONTH_TEXT =
  'Выберите месяц из списка: текущий или один из двенадцати прошлых.';

/** 409: журнал площадки продавцу не загружается — фича закрыта или площадка не подключена. */
export const FINANCE_PULL_NOT_ALLOWED = 'FINANCE_PULL_NOT_ALLOWED';
export const FINANCE_PULL_MONTHS_TEXT =
  'Укажите месяцы журнала: текущий или из двенадцати прошлых.';

/**
 * Месяцы кнопки «Загрузить из Маркета»: непустой список «ГГГГ-ММ» из тех же
 * месяцев, что у экрана «Финансы» и загрузки файлом. Повторы схлопываются, порядок —
 * от свежего, как ночной проход (сверке закрытого месяца нужен следующий).
 */
export function parsePullMonths(
  value: unknown,
  allowed: readonly IFinanceScreenMonth[],
): IFinanceScreenMonth[] | null {
  if (!Array.isArray(value) || !value.length || value.length > allowed.length) return null;
  const wanted = new Set<unknown>(value);
  const months = allowed.filter((month) => wanted.has(month.month));
  return months.length === wanted.size ? months : null;
}

/** Итог ручной загрузки для фронта — перечислением полей. */
export type TCrmFinanceUploadView =
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

/** kind фоновой задачи P&L месяца. */
export const FINANCE_PNL_KIND = 'finance:pnl';

// Разбор периода переехал к финансам (TASK-147): им пользуются и инструменты ИИ,
// а логика не живёт в crm. Имена остаются здесь для прежних потребителей.
export { MAX_RANGE_DAYS, parseDayRange } from '../../finance/finance-period';

export const FINANCE_PERIOD_INVALID_TEXT =
  'Период указан неверно: нужны даты начала и конца, не задом наперёд и не длиннее года.';

/** Период `finance:pnl`: месяц «ГГГГ-ММ» (экран «Финансы») или `{from,to}` (ссылка с «Обзора»). */
export interface IFinanceRangeRequest {
  /** null — период произвольный, не месяц из списка. */
  month: string | null;
  period: IFinancePeriod;
}

export function parseFinanceRangeParams(
  params: Record<string, unknown>,
): IFinanceRangeRequest | null {
  if (params.month !== undefined) {
    const month = parseScreenMonth(params.month);
    return month ? { month: month.month, period: month.period } : null;
  }
  const period = parseDayRange(params.from, params.to);
  return period ? { month: null, period } : null;
}

/**
 * Открыта ли продавцу площадка журнала. ЯМ — всегда (её закрывает `finance`
 * гвардом), Ozon/WB — своими фичами из снимка задачи (у админа — все открыты).
 */
export function isFinanceMarketplaceOpen(
  features: Readonly<Record<string, boolean>>,
  marketplace: TFinanceMarketplace,
): boolean {
  return isMarketplaceFeatureOpen(features, marketplace);
}

export function financeMarketplaceClosedText(marketplace: TFinanceMarketplace): string {
  return `Функция «${MARKETPLACE_LABEL[marketplace]}» закрыта — финансы этой площадки недоступны.`;
}

/** 400: `?marketplace=` не из списка площадок журнала. */
export const FINANCE_MARKETPLACE_INVALID_TEXT = 'Неизвестная площадка: нужна ym, ozon или wb.';

/** Вкладки «Финансов», которые считаются не для каждой площадки (TASK-180). */
export type TFinanceScreenPart = 'cashflow' | 'reconcile' | 'anomalies' | 'upload';

/**
 * Что из вкладок есть у площадки. Выплаты у Ozon — раскладкой сальдо (TASK-184), у WB —
 * `create_dt` строки отчёта (TASK-185); сверка WB ждёт заказов площадки
 * (`RECONCILE_NOT_IMPLEMENTED`), аномалии детектятся только по журналу ЯМ, ручная
 * загрузка — только отчёт ЯМ по платежам.
 */
export const FINANCE_SCREEN_SUPPORT: Record<
  TFinanceMarketplace,
  Record<TFinanceScreenPart, boolean>
> = {
  ym: { cashflow: true, reconcile: true, anomalies: true, upload: true },
  ozon: { cashflow: true, reconcile: true, anomalies: false, upload: false },
  wb: { cashflow: true, reconcile: false, anomalies: false, upload: false },
};

/**
 * Причина, почему вкладки нет у площадки, — показывается вместо нулей и
 * пустого списка: «пусто» значило бы «всё чисто», а это неправда.
 */
export function financeUnsupportedNote(
  part: TFinanceScreenPart,
  marketplace: TFinanceMarketplace,
): string {
  const label = MARKETPLACE_LABEL[marketplace];
  const notes: Record<TFinanceScreenPart, string> = {
    cashflow: `Нет данных о выплатах ${label}: движение денег по этой площадке пока не считается.`,
    reconcile: `Сверка начислений ${label} с заказами ещё не сделана — расхождения не ищутся.`,
    anomalies: `Аномалии пока ищутся только в журнале Яндекс Маркета — для ${label} проверки нет.`,
    upload: 'Загрузить файлом можно только отчёт Маркета по платежам.',
  };
  return notes[part];
}

/** Ответ вкладки, которой у площадки нет: только причина. */
export interface ICrmFinanceUnsupportedView {
  unsupported: true;
  note: string;
}

export function financeUnsupportedView(
  part: TFinanceScreenPart,
  marketplace: TFinanceMarketplace,
): ICrmFinanceUnsupportedView | null {
  return FINANCE_SCREEN_SUPPORT[marketplace][part]
    ? null
    : { unsupported: true, note: financeUnsupportedNote(part, marketplace) };
}

export interface ICrmFinanceArticleView {
  article: TFinanceArticle;
  title: string;
  kopecks: number;
  /** Ровно те операции, что сложились в `kopecks`, — раскрытие статьи. */
  operationIds: string[];
}

export interface ICrmFinanceSectionView {
  key: TPnlSection;
  title: string;
  kopecks: number;
  articles: ICrmFinanceArticleView[];
}

export interface ICrmPnlLevels {
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

/**
 * Уровни P&L — одна функция на «Финансы» и «Обзор» (TASK-125): карточки
 * главной равны строкам «Прибыли» по построению, а не по совпадению полей.
 */
export function pnlLevelsOf(report: IPnlReport): ICrmPnlLevels {
  const { pnl } = report;
  return {
    revenueKopecks: pnl.revenueKopecks,
    otherIncomeKopecks: pnl.otherIncomeKopecks,
    cogsKopecks: pnl.cogs.kopecks,
    grossKopecks: pnl.grossKopecks,
    marketplaceKopecks: pnl.marketplaceKopecks,
    unrecognizedKopecks: pnl.unrecognizedKopecks,
    afterMarketplaceKopecks: pnl.afterMarketplaceKopecks,
    operatingExpensesKopecks: pnl.operatingExpenses.totalKopecks,
    operatingKopecks: pnl.operatingKopecks,
    taxKopecks: pnl.tax.taxKopecks,
    netKopecks: pnl.netKopecks,
    grossMargin: pnl.grossMargin,
    netMargin: pnl.netMargin,
  };
}

export interface ICrmPnlView {
  /**
   * Эхо запроса: «ГГГГ-ММ» или null у произвольного периода (тогда эхо — from/to).
   * Дедуп задач по kind вернёт идущую задачу другого периода.
   */
  month: string | null;
  /** Эхо площадки (TASK-137) — по той же причине, что эхо периода. */
  marketplace: TFinanceMarketplace;
  from: string;
  to: string;
  status: TFinancePeriodStatus;
  statusLabel: string;
  /** Признак движка (TASK-119): сколько заказов и на какую сумму продано без закупа. */
  unconfirmed: IUnconfirmedProfit;
  /** Налог по умолчанию (УСН «Доходы» 6 %), продавец его не подтверждал. */
  taxIsDefault: boolean;
  levels: ICrmPnlLevels;
  /** Разделы со статьями; пустые статьи опущены, пустой раздел — тоже. */
  sections: ICrmFinanceSectionView[];
  tax: { incomeKopecks: number; minimumApplied: boolean; undatedLines: number };
  /** Плоская оценка «Прибыли» — только у непроверенного текущего месяца, подписана «предварительно». */
  flat: IPnlFlatEstimate | null;
  flatNote: string | null;
}

export function toCrmPnlView(
  month: string | null,
  report: IPnlReport,
  marketplace: TFinanceMarketplace = 'ym',
): ICrmPnlView {
  const { pnl } = report;
  const sections: ICrmFinanceSectionView[] = [];
  for (const key of PNL_SECTION_ORDER) {
    const articles = FINANCE_ARTICLE_KEYS.filter((article) => PNL_SECTION[article] === key)
      .map((article) => ({
        article,
        title: FINANCE_ARTICLE_META[article].title,
        kopecks: pnl.byArticle[article].kopecks,
        operationIds: [...pnl.byArticle[article].operationIds],
      }))
      .filter((row) => row.operationIds.length > 0);
    if (!articles.length) continue;
    sections.push({
      key,
      title: PNL_SECTION_TITLE[key],
      kopecks: articles.reduce((sum, row) => sum + row.kopecks, 0),
      articles,
    });
  }

  return {
    month,
    marketplace,
    from: pnl.period.from,
    to: pnl.period.to,
    status: report.status,
    statusLabel: report.statusLabel,
    unconfirmed: pnl.unconfirmed,
    taxIsDefault: report.taxIsDefault,
    levels: pnlLevelsOf(report),
    sections,
    tax: {
      incomeKopecks: pnl.tax.incomeKopecks,
      minimumApplied: pnl.tax.minimumApplied,
      undatedLines: pnl.tax.undatedLines,
    },
    flat: report.flat ? { ...report.flat } : null,
    flatNote: report.flatNote,
  };
}

export interface ICrmFinanceMonthView {
  month: string;
  from: string;
  to: string;
  /** null — журнал за месяц не загружался. */
  status: TFinancePeriodStatus | null;
  statusLabel: string;
  discrepancyCount: number;
  changedCount: number;
  removedCount: number;
  unknownCount: number;
  /** Почему сверка не сделана или упала; null — сделана или не начиналась. */
  reconcileNote: string | null;
  /** Последняя попытка загрузки (и неудачная тоже); null — не грузили. */
  checkedAt: string | null;
  /**
   * В журнале есть версия отчёта. Не то же, что `status !== null`: первая же
   * упавшая загрузка заводит строку периода со статусом, а данных нет.
   */
  loaded: boolean;
  /** Почему упала последняя загрузка; null — прошла или не грузили. */
  error: string | null;
}

export const FINANCE_NOT_LOADED_LABEL = 'Журнал не загружен';

export function toCrmFinanceMonths(months: IFinanceScreenMonthState[]): ICrmFinanceMonthView[] {
  return months.map(({ month, period, state }) => ({
    month,
    from: period.from,
    to: period.to,
    status: state?.status ?? null,
    statusLabel: state ? FINANCE_PERIOD_STATUS_LABEL[state.status] : FINANCE_NOT_LOADED_LABEL,
    discrepancyCount: state?.discrepancyCount ?? 0,
    changedCount: state?.changedCount ?? 0,
    removedCount: state?.removedCount ?? 0,
    unknownCount: state?.unknownCount ?? 0,
    reconcileNote: state?.reconcileNote ?? null,
    checkedAt: state ? state.checkedAt.toISOString() : null,
    loaded: (state?.documentVersion ?? null) !== null,
    error: state?.error ?? null,
  }));
}

export interface ICrmFinanceOperationView {
  id: string;
  article: TFinanceArticle;
  articleTitle: string;
  amountKopecks: number;
  orderId: string | null;
  sku: string | null;
  count: number | null;
  serviceName: string | null;
  transactionType: string | null;
  transactionSource: string | null;
  accruedAt: string;
  paidAt: string | null;
  actDate: string | null;
  bankOrderId: string | null;
  documentId: string | null;
  /**
   * Расшифровка одной суммы по статьям (TASK-155, сводная строка акта ЯМ); null —
   * операция целиком своей статьи. Части одной статьи сложены: раскрытие статьи
   * P&L показывает долю этой статьи, и сумма раскрытия сходится с суммой статьи.
   */
  parts: { article: TFinanceArticle; articleTitle: string; kopecks: number }[] | null;
}

/** Части расшифровки по статьям — та же свёртка, что `expandBreakdown` у P&L. */
function partsOf(row: IFinanceScreenOperation): ICrmFinanceOperationView['parts'] {
  const parts = breakdownOf(row.breakdown);
  // Битая или несходящаяся расшифровка: P&L читает строку целой — и экран тоже.
  if (!parts || parts.reduce((sum, p) => sum + p.kopecks, 0) !== row.amountKopecks) return null;
  return expandBreakdown([row]).map((part) => ({
    article: part.article,
    articleTitle: FINANCE_ARTICLE_META[part.article]?.title ?? part.article,
    kopecks: part.amountKopecks,
  }));
}

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toCrmFinanceOperation(row: IFinanceScreenOperation): ICrmFinanceOperationView {
  const count = row.count === null ? null : Number(row.count);
  return {
    id: row.id,
    article: row.article,
    articleTitle: FINANCE_ARTICLE_META[row.article]?.title ?? row.article,
    amountKopecks: row.amountKopecks,
    orderId: row.orderId,
    sku: row.sku,
    count: count !== null && Number.isFinite(count) ? count : null,
    serviceName: row.serviceName,
    transactionType: row.transactionType,
    transactionSource: row.transactionSource,
    accruedAt: row.accruedAt.toISOString(),
    paidAt: isoOrNull(row.paidAt),
    actDate: isoOrNull(row.actDate),
    bankOrderId: row.bankOrderId,
    documentId: row.documentId,
    parts: partsOf(row),
  };
}

export interface ICrmFinanceDiscrepancyView {
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

export function toCrmFinanceDiscrepancy(row: TFinanceDiscrepancyRow): ICrmFinanceDiscrepancyView {
  return {
    kind: row.kind,
    kindLabel: RECONCILE_KIND_LABEL[row.kind] ?? row.kind,
    orderId: row.orderId,
    bankOrderId: row.bankOrderId,
    operationIds: [...row.operationIds],
    operationCount: row.operationCount,
    expectedKopecks: row.expectedKopecks,
    actualKopecks: row.actualKopecks,
    detail: row.detail,
  };
}

export interface ICrmFinanceAnomalyView {
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

export interface ICrmFinanceAnomaliesView {
  total: number;
  /** Непросмотренных в месяце — независимо от фильтра. */
  unreviewed: number;
  /** ISO; null — детектор месяц не проверял. */
  checkedAt: string | null;
  items: ICrmFinanceAnomalyView[];
}

/** Перечислением полей — довод `/auth/me`: в ответ не уезжает ничего лишнего. */
export function toCrmFinanceAnomaly(row: IFinanceAnomalyRow): ICrmFinanceAnomalyView {
  return {
    key: row.key,
    kind: row.kind,
    kindLabel: ANOMALY_KIND_LABEL[row.kind] ?? row.kind,
    threshold: row.threshold,
    detail: row.detail,
    amountKopecks: row.amountKopecks,
    sku: row.sku,
    orderId: row.orderId,
    operationIds: [...row.operationIds],
    operationCount: row.operationCount,
    reviewed: row.reviewed,
  };
}

export interface ICrmFinanceCorrectionSide {
  amountKopecks: number;
  accruedAt: string;
  article: string;
  articleTitle: string;
  transactionType: string;
  serviceName: string | null;
  orderId: string | null;
  sku: string | null;
}

export interface ICrmFinanceCorrectionView {
  kind: 'changed' | 'removed';
  documentVersion: number;
  before: ICrmFinanceCorrectionSide;
  after: ICrmFinanceCorrectionSide | null;
  createdAt: string;
}

function sideOf(side: TFinanceCorrectionRow['before']): ICrmFinanceCorrectionSide {
  const article = side.article as TFinanceArticle;
  return {
    amountKopecks: side.amountKopecks,
    // jsonb отдаёт дату строкой, хотя тип стороны — Date.
    accruedAt:
      side.accruedAt instanceof Date ? side.accruedAt.toISOString() : String(side.accruedAt),
    article: side.article,
    articleTitle: FINANCE_ARTICLE_META[article]?.title ?? side.article,
    transactionType: side.transactionType,
    serviceName: side.serviceName ?? null,
    orderId: side.orderId ?? null,
    sku: side.sku ?? null,
  };
}

export function toCrmFinanceCorrection(row: TFinanceCorrectionRow): ICrmFinanceCorrectionView {
  return {
    kind: row.kind,
    documentVersion: row.documentVersion,
    before: sideOf(row.before),
    after: row.after ? sideOf(row.after) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ICrmCashflowView {
  from: string;
  to: string;
  inflow: { payoutsKopecks: number; totalKopecks: number };
  outflow: {
    purchasesKopecks: number;
    expensesKopecks: number;
    /** По убыванию суммы; Σ = expensesKopecks. */
    expensesByCategory: { key: string; label: string; kopecks: number }[];
    taxesKopecks: number;
    totalKopecks: number;
  };
  netKopecks: number;
  payouts: IPayout[];
  receivable: {
    asOf: string;
    totalKopecks: number;
    operationCount: number;
    byArticle: { article: string; label: string; kopecks: number; operationCount: number }[];
  };
}

/** ДДС месяца — переехал из «Закупок» (решение `finance_crm_cashflow_moved`). */
export function toCrmCashflowView(
  report: ICashflowReport,
  categoryLabel: (key: string) => string,
): ICrmCashflowView {
  const { cashflow, receivable } = report;
  return {
    from: cashflow.period.from,
    to: cashflow.period.to,
    inflow: { ...cashflow.inflow },
    outflow: {
      purchasesKopecks: cashflow.outflow.purchasesKopecks,
      expensesKopecks: cashflow.outflow.expensesKopecks,
      expensesByCategory: Object.entries(cashflow.outflow.expensesByCategory)
        .map(([key, kopecks]) => ({ key, label: categoryLabel(key), kopecks }))
        .sort((a, b) => b.kopecks - a.kopecks),
      taxesKopecks: cashflow.outflow.taxesKopecks,
      totalKopecks: cashflow.outflow.totalKopecks,
    },
    netKopecks: cashflow.netKopecks,
    payouts: cashflow.payouts.map((payout) => ({ ...payout })),
    receivable: {
      asOf: receivable.asOf,
      totalKopecks: receivable.totalKopecks,
      operationCount: receivable.operationCount,
      byArticle: receivable.byArticle.map((row) => ({
        article: row.article,
        label: FINANCE_ARTICLE_META[row.article].title,
        kopecks: row.kopecks,
        operationCount: row.operationCount,
      })),
    },
  };
}
