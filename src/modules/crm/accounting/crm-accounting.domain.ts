import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type {
  TAccountingCostChangeRow,
  TAccountingCostRow,
} from '../../../database/postgres/repositories/accounting-cost-history.repository';
import type {
  TManualOperationChangeRow,
  TManualOperationRow,
} from '../../../database/postgres/repositories/accounting-manual-operation.repository';
import type { IAccountingAnalytics } from '../../accounting/accounting-analytics.service';
import type {
  IAccountingCostValue,
  TAccountingCostChangeAction,
  TAccountingCostSource,
} from '../../accounting/accounting-cost-history.domain';
import type { ICostSettingsSnapshot } from '../../accounting/accounting-cost-settings.service';
import type {
  IDashboardFilter,
  TDashboardBasis,
  TDashboardLine,
} from '../../accounting/accounting-dashboard.domain';
import type {
  IAccountingDashboard,
  IAccountingDashboardDrill,
  IDashboardQuery,
} from '../../accounting/accounting-dashboard.service';
import type { IAccountingLotRemaining } from '../../accounting/accounting-lot-cost.service';
import type { TAccountingCostMethod } from '../../accounting/accounting-lots.domain';
import type {
  IAccountingOrderCard,
  IAccountingOrdersFilter,
  IAccountingOrdersList,
  IOrderCardAmount,
  IOrderCardCostLine,
  IOrderCardSnapshotVersion,
} from '../../accounting/accounting-order-card.domain';
import type { IAccountingReconcileResult } from '../../accounting/accounting-reconcile.domain';
import type { IAccountingReturns } from '../../accounting/accounting-returns.service';
import type {
  ITaxDeductible,
  TTaxBaseComponent,
  TTaxBaseRule,
} from '../../accounting/accounting-tax';
import type { ITaxBaseRuleSnapshot } from '../../accounting/accounting-tax-settings.service';
import type { IAccountingTaxYearReport } from '../../accounting/accounting-tax.service';
import type { IManualOperationValue } from '../../accounting/manual-operation.domain';
import type { TOrderProfitState } from '../../accounting/order-profit-state';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TTaxYearPeriod } from '../../finance/tax-year.domain';
import type { IProductPurchase } from '../../products/product.domain';
import type { ICrmTaxYear } from '../taxes/crm-taxes.domain';

import { FINANCE_MARKETPLACES } from '../../../database/postgres/finance.schema';
import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import {
  DASHBOARD_BASIS_TITLE,
  DASHBOARD_LINE_TITLE,
} from '../../accounting/accounting-dashboard.domain';
import {
  ACCOUNTING_COST_METHOD_TITLE,
  ACCOUNTING_COST_METHODS,
} from '../../accounting/accounting-lots.domain';
import { ACCOUNTING_SUB_ARTICLE_TITLE } from '../../accounting/accounting-sub-articles';
import {
  PAID_DAY_FALLBACK_NOTE,
  TAX_BASE_RULE_HINT,
  TAX_BASE_RULE_TITLE,
} from '../../accounting/accounting-tax';
import {
  MANUAL_OPERATION_ACTION_LABEL,
  MANUAL_OPERATION_FIELDS,
  MAX_DOCUMENT_NUMBER_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_REF_LENGTH,
  MAX_SOURCE_LENGTH,
  changedFields,
  isManualArticle,
} from '../../accounting/manual-operation.domain';
import {
  ORDER_PROFIT_STATE_TITLE,
  ORDER_RESULT_SNAPSHOT_REASON_TITLE,
} from '../../accounting/order-profit-state';
import { ORDER_TAX_ESTIMATE_NOTE } from '../../accounting/order-result';
import { FINANCE_ARTICLE_KEYS, FINANCE_ARTICLE_META } from '../../finance/finance-articles';
import { parseDayRange } from '../../finance/finance-period';
import { PRODUCT_CURRENCIES } from '../../products/product-purchase.domain';
import { BRAND_KEYS, brandTitle, isBrandKey } from '../../yandex/reports/brands';
import { PERIOD, periodBounds } from '../../yandex/reports/report-period';
import { parsePeriodParams } from '../jobs/crm-period.domain';
import { toCrmTaxYear } from '../taxes/crm-taxes.domain';

/** Коды ошибок раздела — фронт ставит их под поле или показывает «не найдено». */
export const INVALID_MANUAL_OPERATION = 'INVALID_MANUAL_OPERATION';
export const MANUAL_OPERATION_NOT_FOUND = 'MANUAL_OPERATION_NOT_FOUND';
/** Месяц сверки v2 не «ГГГГ-ММ». */
export const INVALID_RECONCILE_MONTH = 'INVALID_RECONCILE_MONTH';
/** Площадка сверки v2 не ym/ozon/wb (TASK-227). */
export const INVALID_RECONCILE_MARKETPLACE = 'INVALID_RECONCILE_MARKETPLACE';
/** Площадка сверки не подключена или закрыта фичей (TASK-227). */
export const RECONCILE_MARKETPLACE_UNAVAILABLE = 'RECONCILE_MARKETPLACE_UNAVAILABLE';
/** Исправление закупа v2 не прошло проверку / товара нет (TASK-213). */
export const INVALID_COST_CORRECTION = 'INVALID_COST_CORRECTION';
export const COST_PRODUCT_NOT_FOUND = 'COST_PRODUCT_NOT_FOUND';

/**
 * Загрузка отчёта WB «Продвижение» файлом (TASK-209). Тот же файл второй раз —
 * `unchanged`, операций не трогали; новый файл — сколько строк легло впервые
 * (`inserted`) и сколько уже было (`matched`).
 */
export type TCrmAccountingUploadView =
  | { status: 'unchanged'; month: string; rows: number }
  | { status: 'imported'; month: string; rows: number; inserted: number; matched: number };

export const WB_PROMOTION_UPLOAD_NO_FILE_TEXT =
  'Выберите файл отчёта WB «Продвижение» (.xlsx, .xls или .csv).';
export const WB_PROMOTION_UPLOAD_BAD_EXTENSION_TEXT =
  'Нужен файл .xlsx, .xls или .csv — выгрузка из кабинета WB «Продвижение».';

export interface ICrmOption {
  key: string;
  label: string;
}

export interface ICrmManualOperation {
  id: string;
  marketplace: string;
  marketplaceLabel: string;
  article: string;
  articleLabel: string;
  subArticle: string | null;
  subArticleLabel: string | null;
  amountKopecks: number;
  accruedOn: string;
  orderId: string | null;
  sku: string | null;
  source: string;
  documentNumber: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICrmManualOperationsView {
  items: ICrmManualOperation[];
  options: { marketplaces: ICrmOption[]; articles: ICrmOption[]; subArticles: ICrmOption[] };
  limits: { source: number; documentNumber: number; ref: number; note: number };
}

export interface ICrmManualOperationChange {
  id: string;
  action: string;
  actionLabel: string;
  /** Что поменялось: подпись поля, было, стало — словами для экрана. */
  changes: { field: string; before: string | null; after: string | null }[];
  author: string;
  impersonatedBy: string | null;
  createdAt: string;
}

const subLabel = (key: string | null) =>
  key
    ? (ACCOUNTING_SUB_ARTICLE_TITLE[key as keyof typeof ACCOUNTING_SUB_ARTICLE_TITLE] ?? key)
    : null;

export function toCrmManualOperation(row: TManualOperationRow): ICrmManualOperation {
  return {
    id: row.id,
    marketplace: row.marketplace,
    marketplaceLabel: MARKETPLACE_LABEL[row.marketplace],
    article: row.article,
    articleLabel: FINANCE_ARTICLE_META[row.article]?.title ?? row.article,
    subArticle: row.subArticle ?? null,
    subArticleLabel: subLabel(row.subArticle ?? null),
    amountKopecks: row.amountKopecks,
    accruedOn: row.accruedOn,
    orderId: row.orderId ?? null,
    sku: row.sku ?? null,
    source: row.source,
    documentNumber: row.documentNumber ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCrmManualOperationsView(rows: TManualOperationRow[]): ICrmManualOperationsView {
  return {
    items: rows.map(toCrmManualOperation),
    options: {
      marketplaces: FINANCE_MARKETPLACES.map((key) => ({ key, label: MARKETPLACE_LABEL[key] })),
      articles: FINANCE_ARTICLE_KEYS.filter(isManualArticle).map((key) => ({
        key,
        label: FINANCE_ARTICLE_META[key].title,
      })),
      subArticles: Object.entries(ACCOUNTING_SUB_ARTICLE_TITLE)
        .filter(([key]) => key !== 'unknown')
        .map(([key, label]) => ({ key, label })),
    },
    limits: {
      source: MAX_SOURCE_LENGTH,
      documentNumber: MAX_DOCUMENT_NUMBER_LENGTH,
      ref: MAX_REF_LENGTH,
      note: MAX_NOTE_LENGTH,
    },
  };
}

const rub = (kopecks: number) =>
  `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/** Значение поля словами: площадка и статьи — подписями, сумма — рублями. */
function fieldText(key: keyof IManualOperationValue, value: IManualOperationValue): string | null {
  const raw = value[key];
  if (raw === null || raw === undefined) return null;
  switch (key) {
    case 'marketplace':
      return MARKETPLACE_LABEL[value.marketplace];
    case 'article':
      return FINANCE_ARTICLE_META[value.article]?.title ?? value.article;
    case 'subArticle':
      return subLabel(value.subArticle);
    case 'amountKopecks':
      return rub(value.amountKopecks);
    default:
      return String(raw);
  }
}

/** Запись журнала → «было/стало» по изменившимся полям (у создания — все заполненные). */
export function toCrmManualOperationChange(
  row: TManualOperationChangeRow,
): ICrmManualOperationChange {
  const before = row.before ?? null;
  const after = row.after ?? null;
  let keys: (keyof IManualOperationValue)[];
  if (before && after) keys = changedFields(before, after);
  else {
    const only = before ?? after;
    keys = (Object.keys(MANUAL_OPERATION_FIELDS) as (keyof IManualOperationValue)[]).filter(
      (key) => only && only[key] !== null && only[key] !== undefined,
    );
  }
  return {
    id: row.id,
    action: row.action,
    actionLabel: MANUAL_OPERATION_ACTION_LABEL[row.action],
    changes: keys.map((key) => ({
      field: MANUAL_OPERATION_FIELDS[key],
      before: before ? fieldText(key, before) : null,
      after: after ? fieldText(key, after) : null,
    })),
    author: row.author,
    impersonatedBy: row.impersonatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Тело запроса — объект или пустой объект: разбор полей делает домен. */
export function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

const COST_SOURCE_LABEL: Record<TAccountingCostSource, string> = {
  'price-list': 'Прайс',
  manual: 'Исправлено вручную',
  'cost-history': 'Перенесено из истории себестоимости',
};

const COST_CHANGE_ACTION_LABEL: Record<TAccountingCostChangeAction, string> = {
  insert: 'Добавлена цена',
  correct: 'Исправлена цена',
};

/** Запись истории закупа v2: момент ISO, закуп, источник, кто исправил. */
export interface ICrmCostRecord {
  id: string;
  validFrom: string;
  purchase: IProductPurchase;
  source: TAccountingCostSource;
  sourceLabel: string;
  author: string | null;
}

/** Строка журнала исправлений: было/стало, автор, причина. */
export interface ICrmCostChange {
  id: string;
  action: TAccountingCostChangeAction;
  actionLabel: string;
  before: IAccountingCostValue | null;
  after: IAccountingCostValue;
  author: string;
  impersonatedBy: string | null;
  reason: string;
  createdAt: string;
}

export interface ICrmCostHistoryView {
  records: ICrmCostRecord[];
  changes: ICrmCostChange[];
}

export function toCrmCostHistoryView(view: {
  records: TAccountingCostRow[];
  changes: TAccountingCostChangeRow[];
}): ICrmCostHistoryView {
  return {
    records: view.records.map((row) => ({
      id: row.id,
      validFrom: row.validFrom.toISOString(),
      purchase: row.purchase,
      source: row.source,
      sourceLabel: COST_SOURCE_LABEL[row.source],
      author: row.author ?? null,
    })),
    changes: view.changes.map((row) => ({
      id: row.id,
      action: row.action,
      actionLabel: COST_CHANGE_ACTION_LABEL[row.action],
      before: row.before ?? null,
      after: row.after,
      author: row.author,
      impersonatedBy: row.impersonatedBy ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** Поиск товара для истории закупа v2: столько вариантов в ответе, не страница. */
export const COST_PRODUCT_SEARCH_LIMIT = 20;
const COST_PRODUCT_QUERY_MAX = 200;

/** Вариант поиска: только чтобы выбрать товар — без закупа и бренда. */
export interface ICrmCostProductOption {
  id: string;
  internalSku: string;
  name: string | null;
}

export interface ICrmCostProducts {
  /** Нашлось всего — больше, чем `items`, когда запрос надо уточнить. */
  total: number;
  items: ICrmCostProductOption[];
  /** Валюты формы исправления — те же, что у правки закупа «Товаров». */
  currencies: readonly string[];
}

/** Строка поиска как в «Товарах»: не строка или пусто — без фильтра, длина обрезана. */
export function costProductQuery(q: unknown): string | undefined {
  if (typeof q !== 'string') return undefined;
  const trimmed = q.trim().slice(0, COST_PRODUCT_QUERY_MAX);
  return trimmed || undefined;
}

export function toCrmCostProducts(view: {
  total: number;
  items: { id: string; internalSku: string; name: string | null }[];
}): ICrmCostProducts {
  return {
    total: view.total,
    items: view.items.map((item) => ({
      id: item.id,
      internalSku: item.internalSku,
      name: item.name,
    })),
    currencies: PRODUCT_CURRENCIES,
  };
}

/* ── Налог нового учёта (ТЗ п.6, TASK-221) ──────────────────────────────── */

/** Kind года налога «Финучёта»: журнал всех площадок за год — фоновая задача, не GET. */
export const ACCOUNTING_TAX_YEAR_KIND = 'accounting:tax-year';

export const INVALID_TAX_BASE_RULE = 'INVALID_TAX_BASE_RULE';
export const INVALID_COST_METHOD = 'INVALID_COST_METHOD';

/** Режим себестоимости «Финучёта» (TASK-215) и варианты выбора. */
export interface ICrmCostSettings {
  method: TAccountingCostMethod;
  methodTitle: string;
  isDefault: boolean;
  updatedAt: string | null;
  options: ICrmOption[];
}

export function toCrmCostSettings(snapshot: ICostSettingsSnapshot): ICrmCostSettings {
  return {
    method: snapshot.method,
    methodTitle: snapshot.methodTitle,
    isDefault: snapshot.isDefault,
    updatedAt: snapshot.updatedAt ? snapshot.updatedAt.toISOString() : null,
    options: ACCOUNTING_COST_METHODS.map((key) => ({
      key,
      label: ACCOUNTING_COST_METHOD_TITLE[key],
    })),
  };
}

/* ── Партии и остатки (TASK-216) ─────────────────────────────────────────── */

/** Партия на экране: остаток — из FIFO, цены — копейки. */
export interface ICrmAccountingLot {
  lotId: string;
  purchaseId: string;
  supplier: string;
  /** «ГГГГ-ММ-ДД» — день поступления (= день оплаты закупки). */
  receivedDay: string;
  sku: string;
  name: string | null;
  /** false — артикул не сопоставлен с товаром: FIFO партию не списывает. */
  productMatched: boolean;
  count: number;
  remaining: number;
  unitPriceKopecks: number;
  /** Доставка и прочие расходы на всю строку. */
  extraKopecks: number;
  /** Цена штуки с доп. расходами, округлённая до копейки. */
  unitCostKopecks: number;
  /** Стоимость остатка с доп. расходами, округлённая до копейки. */
  remainingCostKopecks: number;
}

export interface ICrmAccountingLots {
  lots: ICrmAccountingLot[];
  totals: { remaining: number; remainingCostKopecks: number };
}

export function toCrmLots(rows: readonly IAccountingLotRemaining[]): ICrmAccountingLots {
  const lots = rows
    .map((row, index) => {
      const totalKopecks = row.count * row.unitPriceKopecks + row.extraKopecks;
      const unitCost = row.count > 0 ? totalKopecks / row.count : row.unitPriceKopecks;
      const lot: ICrmAccountingLot = {
        lotId: row.id,
        purchaseId: row.purchaseId,
        supplier: row.supplier,
        receivedDay: row.receivedDay,
        sku: row.sku,
        name: row.name,
        productMatched: row.productId !== null,
        count: row.count,
        remaining: row.remaining,
        unitPriceKopecks: row.unitPriceKopecks,
        extraKopecks: row.extraKopecks,
        unitCostKopecks: Math.round(unitCost),
        remainingCostKopecks: Math.round(unitCost * row.remaining),
      };
      return { lot, index };
    })
    // Свежие поступления сверху; внутри дня — порядок FIFO.
    .sort((a, b) => b.lot.receivedDay.localeCompare(a.lot.receivedDay) || a.index - b.index)
    .map(({ lot }) => lot);
  return {
    lots,
    totals: {
      remaining: lots.reduce((sum, lot) => sum + lot.remaining, 0),
      remainingCostKopecks: lots.reduce((sum, lot) => sum + lot.remainingCostKopecks, 0),
    },
  };
}

export interface ICrmTaxBaseRule {
  rule: TTaxBaseRule;
  ruleTitle: string;
  ruleHint: string;
  isDefault: boolean;
  updatedAt: string | null;
  options: (ICrmOption & { hint: string })[];
}

export function toCrmTaxBaseRule(snapshot: ITaxBaseRuleSnapshot): ICrmTaxBaseRule {
  return {
    rule: snapshot.rule,
    ruleTitle: snapshot.ruleTitle,
    ruleHint: snapshot.ruleHint,
    isDefault: snapshot.isDefault,
    updatedAt: snapshot.updatedAt ? snapshot.updatedAt.toISOString() : null,
    options: (Object.keys(TAX_BASE_RULE_TITLE) as TTaxBaseRule[]).map((key) => ({
      key,
      label: TAX_BASE_RULE_TITLE[key],
      hint: TAX_BASE_RULE_HINT[key],
    })),
  };
}

/** Раскрытие базы отчётного периода — до операций. */
export interface ICrmAccountingTaxBasis {
  period: TTaxYearPeriod;
  composition: {
    component: TTaxBaseComponent;
    title: string;
    kopecks: number;
    count: number;
    operationIds: string[];
  }[];
  byMarketplace: {
    marketplace: TFinanceMarketplace;
    label: string;
    kopecks: number;
    count: number;
  }[];
  deductible: ITaxDeductible;
  /** null — подстановок не было. */
  paidDayFallback: { lines: number; note: string } | null;
  undatedOperationIds: string[];
}

export interface ICrmAccountingTaxYear extends ICrmTaxYear {
  baseRule: ICrmTaxBaseRule;
  marketplaces: { marketplace: TFinanceMarketplace; label: string }[];
  basis: ICrmAccountingTaxBasis[];
  /** Пометка для налога на заказ — экран печатает её отсюда. */
  orderTaxNote: string;
}

/** Год налога «Финучёта»: вид года «Налогов» + правило базы и её раскрытие. */
export function toCrmAccountingTaxYear(report: IAccountingTaxYearReport): ICrmAccountingTaxYear {
  return {
    ...toCrmTaxYear(report),
    baseRule: toCrmTaxBaseRule(report.baseRule),
    marketplaces: report.marketplaces.map((marketplace) => ({
      marketplace,
      label: MARKETPLACE_LABEL[marketplace],
    })),
    basis: report.periods.map((p) => ({
      period: p.key,
      composition: p.accounting.composition.map((c) => ({
        component: c.component,
        title: c.title,
        kopecks: c.kopecks,
        count: c.count,
        operationIds: [...c.operationIds],
      })),
      byMarketplace: p.accounting.byMarketplace.map((m) => ({
        marketplace: m.marketplace,
        label: MARKETPLACE_LABEL[m.marketplace],
        kopecks: m.kopecks,
        count: m.count,
      })),
      deductible: {
        ...p.accounting.deductible,
        unknownCogs: {
          count: p.accounting.deductible.unknownCogs.count,
          operationIds: [...p.accounting.deductible.unknownCogs.operationIds],
        },
      },
      paidDayFallback: p.accounting.paidDayFallbackLines
        ? { lines: p.accounting.paidDayFallbackLines, note: PAID_DAY_FALLBACK_NOTE }
        : null,
      undatedOperationIds: [...p.accounting.undatedOperationIds],
    })),
    orderTaxNote: ORDER_TAX_ESTIMATE_NOTE,
  };
}

/* ── Карточка и список заказов (ТЗ п.4–п.7, TASK-222) ───────────────────── */

/** Карточка заказа: месяц его журнала, распределение и налог — фоновая задача, не GET. */
export const ACCOUNTING_ORDER_KIND = 'accounting:order';
/** Заказы месяца оформления. */
export const ACCOUNTING_ORDERS_KIND = 'accounting:orders';

export const ACCOUNTING_ORDER_BAD_PARAMS_TEXT =
  'Не удалось разобрать заказ. Откройте его заново из списка.';
export const ACCOUNTING_ORDERS_BAD_MONTH_TEXT = 'Выберите месяц в формате ГГГГ-ММ.';
export const ACCOUNTING_ORDERS_BAD_FILTER_TEXT =
  'Не удалось разобрать фильтр списка. Сбросьте его и выберите заново.';
export const ACCOUNTING_ORDER_NOT_FOUND_TEXT =
  'Заказ не найден в «Финучёте» этого магазина: строки заказа ещё не загружены или площадка выключена.';
export const ACCOUNTING_ORDER_NO_STORE_TEXT =
  'Откройте магазин Яндекс Маркета, чтобы увидеть его заказы.';

const PROFIT_STATES: Record<TOrderProfitState, true> = {
  forecast: true,
  preliminary: true,
  reconciled: true,
};

function marketplaceOf(value: unknown): TFinanceMarketplace | null {
  return typeof value === 'string' && (FINANCE_MARKETPLACES as readonly string[]).includes(value)
    ? (value as TFinanceMarketplace)
    : null;
}

/**
 * Площадка сверки из query (TASK-227): пусто — `null` (выбрать первую
 * доступную), мусор — `undefined` (400).
 */
export function parseReconcileMarketplace(value: unknown): TFinanceMarketplace | null | undefined {
  if (value === undefined || value === '') return null;
  return marketplaceOf(value) ?? undefined;
}

/**
 * Площадка сверки: запрошенная Ozon/WB — только из доступных (подключена и
 * открыта фичей); ЯМ — всегда, как до TASK-227. Без запроса — первая доступная,
 * иначе ЯМ. null — запрошенная недоступна.
 */
export function pickReconcileMarketplace(
  requested: TFinanceMarketplace | null,
  available: readonly TFinanceMarketplace[],
): TFinanceMarketplace | null {
  if (!requested) return available[0] ?? 'ym';
  if (requested === 'ym' || available.includes(requested)) return requested;
  return null;
}

export interface ICrmAccountingReconcile extends IAccountingReconcileResult {
  /** Площадки для выбора; одна или ни одной — выбора на экране нет. */
  marketplaceOptions: { marketplace: TFinanceMarketplace; label: string }[];
}

export function toCrmAccountingReconcile(
  result: IAccountingReconcileResult,
  available: readonly TFinanceMarketplace[],
): ICrmAccountingReconcile {
  return {
    ...result,
    marketplaceOptions: available.map((marketplace) => ({
      marketplace,
      label: MARKETPLACE_LABEL[marketplace],
    })),
  };
}

/** `{ marketplace, orderId }` карточки; мусор — null. */
export function parseAccountingOrderParams(
  params: Record<string, unknown>,
): { marketplace: TFinanceMarketplace; orderId: string } | null {
  const marketplace = marketplaceOf(params?.marketplace);
  const orderId = typeof params?.orderId === 'string' ? params.orderId.trim() : '';
  if (!marketplace || !orderId || orderId.length > MAX_REF_LENGTH) return null;
  return { marketplace, orderId };
}

/** Фильтр списка; `null` — мусор в каком-то поле (пустое поле — без фильтра). */
export function parseAccountingOrdersFilter(
  params: Record<string, unknown>,
): IAccountingOrdersFilter | null {
  const raw = params ?? {};
  const filter: IAccountingOrdersFilter = { lossOnly: false };
  if (raw.marketplace !== undefined && raw.marketplace !== null && raw.marketplace !== '') {
    filter.marketplace = marketplaceOf(raw.marketplace);
    if (!filter.marketplace) return null;
  }
  if (raw.state !== undefined && raw.state !== null && raw.state !== '') {
    if (typeof raw.state !== 'string' || !Object.hasOwn(PROFIT_STATES, raw.state)) return null;
    filter.state = raw.state as TOrderProfitState;
  }
  if (raw.lossOnly !== undefined) {
    if (typeof raw.lossOnly !== 'boolean') return null;
    filter.lossOnly = raw.lossOnly;
  }
  return filter;
}

const iso = (at: Date | null): string | null => (at ? new Date(at).toISOString() : null);

export type ICrmAccountingOrderCard = Omit<IAccountingOrderCard, 'amounts' | 'versions'> & {
  marketplaceLabel: string;
  amounts: (Omit<IOrderCardAmount, 'costLines'> & {
    costLines?: (Omit<IOrderCardCostLine, 'recordFrom'> & { recordFrom: string | null })[];
  })[];
  versions: (Omit<IOrderCardSnapshotVersion, 'capturedAt'> & {
    reasonTitle: string;
    capturedAt: string;
  })[];
};

/** Карточка для CRM: даты строками, подписи площадки и причин версий. Магазина ЯМ в ответе нет. */
export function toCrmAccountingOrderCard(card: IAccountingOrderCard): ICrmAccountingOrderCard {
  return {
    ...card,
    marketplaceLabel: MARKETPLACE_LABEL[card.marketplace],
    amounts: card.amounts.map(({ costLines, ...amount }) => ({
      ...amount,
      ...(costLines
        ? { costLines: costLines.map((l) => ({ ...l, recordFrom: iso(l.recordFrom) })) }
        : {}),
    })),
    versions: card.versions.map((v) => ({
      ...v,
      reasonTitle: ORDER_RESULT_SNAPSHOT_REASON_TITLE[v.reason],
      capturedAt: iso(v.capturedAt) ?? '',
    })),
  };
}

/** Эхо фильтра: задачи дедупятся по (продавец, kind, магазин) — фронт сверяет ответ со своим запросом. */
export interface ICrmAccountingOrdersFilter {
  marketplace: TFinanceMarketplace | null;
  state: TOrderProfitState | null;
  lossOnly: boolean;
}

export interface ICrmAccountingOrders extends IAccountingOrdersList {
  filter: ICrmAccountingOrdersFilter;
  marketplaceOptions: { marketplace: TFinanceMarketplace; label: string }[];
  stateOptions: ICrmOption[];
}

export function toCrmAccountingOrders(
  list: IAccountingOrdersList,
  filter: IAccountingOrdersFilter = {},
): ICrmAccountingOrders {
  return {
    ...list,
    filter: {
      marketplace: filter.marketplace ?? null,
      state: filter.state ?? null,
      lossOnly: filter.lossOnly === true,
    },
    marketplaceOptions: list.marketplaces.map((marketplace) => ({
      marketplace,
      label: MARKETPLACE_LABEL[marketplace],
    })),
    stateOptions: (Object.keys(PROFIT_STATES) as TOrderProfitState[]).map((key) => ({
      key,
      label: ORDER_PROFIT_STATE_TITLE[key],
    })),
  };
}

/* ── Возвраты (ТЗ п.3, TASK-225) ─────────────────────────────────────────── */

/** Возвраты месяца оформления: те же карточки, что список заказов, — секунды, фоновая задача. */
export const ACCOUNTING_RETURNS_KIND = 'accounting:returns';
export const ACCOUNTING_RETURNS_BAD_MONTH_TEXT =
  'Не удалось разобрать месяц возвратов. Выберите месяц в списке.';

export type ICrmAccountingReturns = IAccountingReturns;

/** Копейки как есть, подписи площадок — с сервера; площадки колонками, без общего итога. */
export function toCrmAccountingReturns(report: IAccountingReturns): ICrmAccountingReturns {
  return {
    period: report.period,
    marketplaces: report.marketplaces.map((m) => ({ ...m })),
    models: report.models.map((m) => ({ ...m })),
    orders: report.orders.map((o) => ({ ...o })),
  };
}

/* ── Панель (ТЗ п.13, TASK-229) ──────────────────────────────────────────── */

/** Итоги периода в выбранном базисе: карточки месяца, журнал, налог, ДДС — секунды, фоновая задача. */
export const ACCOUNTING_DASHBOARD_KIND = 'accounting:dashboard';
/** Раскрытие одной строки итога до операций. */
export const ACCOUNTING_DASHBOARD_DRILL_KIND = 'accounting:dashboard-drill';

export const ACCOUNTING_DASHBOARD_BAD_BASIS_TEXT =
  'Выберите базис периода: по дате продажи, по дате начисления или по движению денег.';
export const ACCOUNTING_DASHBOARD_BAD_PERIOD_TEXT =
  'Не удалось разобрать период. Выберите сегодня, вчера, неделю, месяц или даты «с — по» (не длиннее года).';
export const ACCOUNTING_DASHBOARD_BAD_FILTER_TEXT =
  'Не удалось разобрать фильтр панели. Сбросьте его и выберите заново.';
export const ACCOUNTING_DASHBOARD_BAD_LINE_TEXT =
  'Не удалось разобрать строку для раскрытия. Откройте её заново из итогов.';

const DASHBOARD_BASES: Record<TDashboardBasis, true> = { sale: true, accrual: true, cash: true };

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;

const isEmpty = (value: unknown) => value === undefined || value === null || value === '';

/** Эхо периода: пресет (`key`, `day`) или «с — по» (`range`). */
export interface ICrmDashboardPeriodEcho {
  key: string | null;
  day: string | null;
  range: { from: string; to: string } | null;
}

export interface ICrmDashboardQuery extends IDashboardQuery {
  periodEcho: ICrmDashboardPeriodEcho;
}

/**
 * Период панели и аналитики: пресет `period: {key, day?}` (сегодня, день, неделя,
 * месяц) или `range: {from, to}` ГГГГ-ММ-ДД ≤ 366 дней; «всё время» и мусор — null.
 */
export function parseAccountingPeriodParams(
  params: Record<string, unknown>,
  now: Date = new Date(),
): { period: IFinancePeriod; periodEcho: ICrmDashboardPeriodEcho } | null {
  const raw = params ?? {};
  if (!isEmpty(raw.range)) {
    const range = raw.range as { from?: unknown; to?: unknown };
    const parsed = typeof range === 'object' ? parseDayRange(range.from, range.to) : null;
    if (!parsed) return null;
    return { period: parsed, periodEcho: { key: null, day: null, range: { ...parsed } } };
  }
  const preset = parsePeriodParams(raw);
  if (preset.key === PERIOD.ALL) return null;
  const bounds = periodBounds(preset, now);
  return {
    period: { from: isoOf(bounds.from), to: isoOf(bounds.to) },
    periodEcho: { key: preset.key, day: preset.day ? isoOf(preset.day) : null, range: null },
  };
}

/**
 * Запрос панели. Базис обязателен — без него `null` (текст `…_BAD_BASIS_TEXT`):
 * итог без базиса не объяснить. Период — пресет `period: {key, day?}` (сегодня,
 * день — для «вчера», неделя, месяц) или `range: {from, to}` ГГГГ-ММ-ДД ≤ 366 дней;
 * мусор — `CrmJobError` с текстом. Фильтры: пустое поле — без фильтра, мусор — `'filter'`.
 */
export function parseAccountingDashboardQuery(
  params: Record<string, unknown>,
  now: Date = new Date(),
): ICrmDashboardQuery | 'basis' | 'period' | 'filter' {
  const raw = params ?? {};
  if (typeof raw.basis !== 'string' || !Object.hasOwn(DASHBOARD_BASES, raw.basis)) return 'basis';
  const basis = raw.basis as TDashboardBasis;

  const parsedPeriod = parseAccountingPeriodParams(raw, now);
  if (!parsedPeriod) return 'period';
  const { period, periodEcho } = parsedPeriod;

  const filter: IDashboardFilter = {};
  if (!isEmpty(raw.marketplace)) {
    filter.marketplace = marketplaceOf(raw.marketplace);
    if (!filter.marketplace) return 'filter';
  }
  if (!isEmpty(raw.brand)) {
    if (!isBrandKey(raw.brand)) return 'filter';
    filter.brand = raw.brand;
  }
  for (const field of ['offerId', 'orderId'] as const) {
    if (isEmpty(raw[field])) continue;
    const value = typeof raw[field] === 'string' ? raw[field].trim() : '';
    if (!value || value.length > MAX_REF_LENGTH) return 'filter';
    filter[field] = value;
  }
  return { basis, period, filter, periodEcho };
}

/** Строка раскрытия и блок: `marketplace` пусто или `all` — «Все площадки». */
export function parseAccountingDashboardLine(
  params: Record<string, unknown>,
): { line: TDashboardLine; marketplace: TFinanceMarketplace | null } | null {
  const raw = params ?? {};
  if (typeof raw.line !== 'string' || !Object.hasOwn(DASHBOARD_LINE_TITLE, raw.line)) return null;
  const block = raw.block;
  if (isEmpty(block) || block === 'all')
    return { line: raw.line as TDashboardLine, marketplace: null };
  const marketplace = marketplaceOf(block);
  return marketplace ? { line: raw.line as TDashboardLine, marketplace } : null;
}

export interface ICrmAccountingDashboard extends Omit<IAccountingDashboard, 'filter'> {
  periodEcho: ICrmDashboardPeriodEcho;
  filter: {
    marketplace: TFinanceMarketplace | null;
    brand: string | null;
    offerId: string | null;
    orderId: string | null;
  };
  basisOptions: ICrmOption[];
  marketplaceOptions: { marketplace: TFinanceMarketplace; label: string }[];
  brandOptions: ICrmOption[];
}

/** Панель для CRM: эхо запроса (дедуп задач по kind), подписи базисов и брендов. */
export function toCrmAccountingDashboard(
  dashboard: IAccountingDashboard,
  query: ICrmDashboardQuery,
): ICrmAccountingDashboard {
  return {
    ...dashboard,
    periodEcho: query.periodEcho,
    filter: {
      marketplace: dashboard.filter.marketplace ?? null,
      brand: dashboard.filter.brand ?? null,
      offerId: dashboard.filter.offerId ?? null,
      orderId: dashboard.filter.orderId ?? null,
    },
    basisOptions: (Object.keys(DASHBOARD_BASES) as TDashboardBasis[]).map((key) => ({
      key,
      label: DASHBOARD_BASIS_TITLE[key],
    })),
    marketplaceOptions: dashboard.marketplaces.map((marketplace) => ({
      marketplace,
      label: MARKETPLACE_LABEL[marketplace],
    })),
    brandOptions: BRAND_KEYS.map((key) => ({ key, label: brandTitle(key) })),
  };
}

export interface ICrmAccountingDashboardDrill extends IAccountingDashboardDrill {
  periodEcho: ICrmDashboardPeriodEcho;
  basisTitle: string;
}

export function toCrmAccountingDashboardDrill(
  drill: IAccountingDashboardDrill,
  query: ICrmDashboardQuery,
): ICrmAccountingDashboardDrill {
  return { ...drill, periodEcho: query.periodEcho, basisTitle: DASHBOARD_BASIS_TITLE[drill.basis] };
}

/* ── Аналитика (ТЗ п.13, TASK-230) ───────────────────────────────────────── */

/** ТОПы товаров, убыточные заказы, возвраты моделей, средние, дни и площадки рядом за период. */
export const ACCOUNTING_ANALYTICS_KIND = 'accounting:analytics';

export interface ICrmAccountingAnalytics extends IAccountingAnalytics {
  periodEcho: ICrmDashboardPeriodEcho;
}

/** Аналитика для CRM: эхо периода — для дедупа задач по kind. */
export function toCrmAccountingAnalytics(
  analytics: IAccountingAnalytics,
  periodEcho: ICrmDashboardPeriodEcho,
): ICrmAccountingAnalytics {
  return { ...analytics, periodEcho };
}
