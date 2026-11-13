/**
 * «Финучёт» CRM (TASK-206): фактический финансовый учёт рядом с «Финансами»
 * (решение accounting_beside_current). Каркас: экран пуст, вкладки — заказы,
 * возвраты, партии, сверка, дашборд — добавят M29–M33, каждая под своей подфичей.
 */

import type { ProductPurchase } from '@/modules/products/products.domain';

export const ACCOUNTING_ROUTE_NAME = 'ym-accounting';

/** Раздел открыт зонтиком; подфичи без него ничего не открывают (`requires`). */
export const ACCOUNTING_FEATURE = 'fin_accounting';

/** Исход попытки загрузки (TASK-212) — как `TFinanceSyncOutcome` сервера. */
export type SyncOutcome = 'empty' | 'unchanged' | 'imported' | 'failed' | 'not-connected';

export interface SyncPeriodResponse {
  month: string;
  from: string;
  to: string;
  lastAttemptAt: string | null;
  outcome: SyncOutcome | null;
  outcomeLabel: string | null;
  trigger: string | null;
  triggerLabel: string | null;
  attempt: number | null;
  error: string | null;
  lastSuccessAt: string | null;
  missed: boolean;
}

export interface SyncMarketplaceResponse {
  marketplace: string;
  label: string;
  lastSuccessAt: string | null;
  periods: SyncPeriodResponse[];
}

/** `GET /ym/accounting/sync` — журнал синхронизации «Финучёта». */
export interface SyncResponse {
  asOf: string | null;
  everyHours: number;
  reloadMonths: number;
  marketplaces: SyncMarketplaceResponse[];
}

/** Тон строки периода: загружен, сбой, пропущен (успеха нет), ещё не грузили. */
export type SyncTone = 'ok' | 'failed' | 'missed' | 'idle';

export interface SyncPeriodRow {
  key: string;
  monthLabel: string;
  tone: SyncTone;
  statusLabel: string;
  /** «Попытка 14:32 · повтор после сбоя, 2-я» — пусто, если попыток не было. */
  attemptLabel: string | null;
  successLabel: string;
  error: string | null;
}

export interface SyncMarketplaceRow {
  marketplace: string;
  label: string;
  /** «данные на 14:32» / «успешной загрузки не было». */
  asOfLabel: string;
  periods: SyncPeriodRow[];
  missedCount: number;
}

export interface SyncView {
  /** «Данные на …» всего раздела; null — у какой-то площадки успеха не было. */
  asOfLabel: string | null;
  scheduleLabel: string;
  marketplaces: SyncMarketplaceRow[];
}

// ─── Ручные операции (TASK-208) ─────────────────────────────────────────────

export interface Option {
  key: string;
  label: string;
}

export interface ManualOperation {
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

/** `GET/POST/PUT/DELETE /ym/accounting/manual-operations` — полный вид раздела. */
export interface ManualOperationsView {
  items: ManualOperation[];
  options: { marketplaces: Option[]; articles: Option[]; subArticles: Option[] };
  limits: { source: number; documentNumber: number; ref: number; note: number };
}

export interface ManualOperationChange {
  id: string;
  action: string;
  actionLabel: string;
  changes: { field: string; before: string | null; after: string | null }[];
  author: string;
  impersonatedBy: string | null;
  createdAt: string;
}

/** Поля формы — строки, как их набирает продавец; разбирает сервер. */
export interface ManualOperationForm {
  marketplace: string;
  article: string;
  subArticle: string;
  amount: string;
  accruedOn: string;
  orderId: string;
  sku: string;
  source: string;
  documentNumber: string;
  note: string;
}

export interface ManualOperationBody {
  /** Ключ формы: повтор той же отправки не создаёт дубль. */
  clientKey?: string;
  marketplace: string;
  article: string;
  subArticle: string | null;
  amount: string;
  accruedOn: string;
  orderId: string | null;
  sku: string | null;
  source: string;
  documentNumber: string | null;
  note: string | null;
}

export type ManualOperationField = keyof ManualOperationForm;
export type ManualOperationErrors = Partial<Record<ManualOperationField | 'form', string>>;

export const MANUAL_OPERATION_ERROR_CODE = {
  INVALID: 'INVALID_MANUAL_OPERATION',
  NOT_FOUND: 'MANUAL_OPERATION_NOT_FOUND',
} as const;

/** Строка таблицы — то, что показывает экран. */
export interface ManualOperationRow {
  id: string;
  dayLabel: string;
  marketplaceLabel: string;
  articleLabel: string;
  amountLabel: string;
  /** «+» — деньги продавцу, «−» — удержание. */
  income: boolean;
  refLabel: string | null;
  sourceLabel: string;
}

// ─── Сверка v2 (TASK-226, экран — TASK-228) ─────────────────────────────────

/** Вкладка сверки: зонтик + своя подфича (`requires`). */
export const ACCOUNTING_RECONCILE_FEATURE = 'fin_accounting_reconcile';

export type ReconcileLineKey =
  | 'sales'
  | 'returns'
  | 'commission'
  | 'logistics'
  | 'other_services'
  | 'compensations'
  | 'unknown'
  | 'accrual_total'
  | 'payouts'
  | 'balance';

export type ReconcileDocument = 'act' | 'payment_orders' | 'ozon_balance';
export type ReconcileLineStatus = 'matched' | 'mismatch' | 'no_document';
export type ReconcileStatus = 'reconciled' | 'discrepancies' | 'insufficient_data';
export type ReconcileCandidateReason = 'duplicate' | 'other_date' | 'no_pair';
export type ReconcileSource = 'journal' | 'manual';

export interface ReconcileCandidate {
  operationId: string;
  source: ReconcileSource;
  reason: ReconcileCandidateReason;
  orderId: string | null;
  article: string;
  subArticle: string | null;
  amountKopecks: number;
  accruedOn: string;
  actDay: string | null;
  paidOn: string | null;
  serviceName: string | null;
  /** Подпись: услуга, иначе подстатья, иначе статья. */
  title: string;
  matchesDifference: boolean;
}

export interface ReconcileLineResponse {
  line: ReconcileLineKey;
  title: string;
  document: ReconcileDocument | null;
  basis: 'act_days' | 'accrued_in_month' | 'paid_in_month';
  registryKopecks: number;
  manualKopecks: number;
  operationCount: number;
  documentKopecks: number | null;
  differenceKopecks: number | null;
  status: ReconcileLineStatus;
  reason: string | null;
  candidates: { items: ReconcileCandidate[]; count: number };
}

export interface ReconcileActResponse {
  actDay: string;
  registryKopecks: number;
  documentKopecks: number | null;
  differenceKopecks: number | null;
  status: ReconcileLineStatus;
  unknownSheets: string[];
}

export interface ReconcilePaymentOrderResponse {
  bankOrderId: string;
  paidOn: string;
  registryKopecks: number;
  documentKopecks: number | null;
  differenceKopecks: number | null;
  status: ReconcileLineStatus;
  operationCount: number;
  reason: string | null;
}

export interface ReconcileStoreLevelResponse {
  operationId: string;
  source: ReconcileSource;
  article: string;
  subArticle: string | null;
  amountKopecks: number;
  accruedOn: string;
  serviceName: string | null;
  title: string;
}

/** `GET /ym/accounting/reconcile?month=ГГГГ-ММ&marketplace=ym|ozon|wb` — сверка v2 месяца. */
export interface ReconcileResponse {
  period: { from: string; to: string };
  /** Площадка сверки (TASK-227). */
  marketplace: AccountingMarketplace;
  /** Площадки для выбора; одна или ни одной — выбора нет. */
  marketplaceOptions: { marketplace: AccountingMarketplace; label: string }[];
  status: ReconcileStatus;
  partial: boolean;
  notes: string[];
  reconciledAt: string;
  dataAsOf: string | null;
  lines: ReconcileLineResponse[];
  acts: ReconcileActResponse[];
  paymentOrders: ReconcilePaymentOrderResponse[];
  storeLevel: { items: ReconcileStoreLevelResponse[]; count: number; totalKopecks: number };
  unmatchedCount: number;
  candidateCount: number;
  discrepantOrderIds: string[];
}

export type ReconcileTone = 'ok' | 'danger' | 'warn' | 'outline';

export interface ReconcileCandidateRow {
  id: string;
  reasonLabel: string;
  amountLabel: string;
  /** |сумма| = |разница| — первая догадка. */
  matchesDifference: boolean;
  orderLabel: string;
  dayLabel: string;
  documentDayLabel: string | null;
  title: string;
  manual: boolean;
}

export interface ReconcileLineRow {
  key: ReconcileLineKey;
  title: string;
  registryLabel: string;
  manualLabel: string | null;
  documentLabel: string;
  differenceLabel: string;
  statusLabel: string;
  tone: ReconcileTone;
  /** Почему документа нет. */
  reason: string | null;
  /** Итоговые строки (итог начислений, выплаты, остаток) — отдельной группой. */
  summary: boolean;
  candidates: ReconcileCandidateRow[];
  candidateCount: number;
}

export interface ReconcileDocumentRow {
  key: string;
  title: string;
  registryLabel: string;
  documentLabel: string;
  differenceLabel: string;
  statusLabel: string;
  tone: ReconcileTone;
  note: string | null;
}

export interface ReconcileStoreLevelRow {
  id: string;
  dayLabel: string;
  title: string;
  amountLabel: string;
  manual: boolean;
}

export interface ReconcileView {
  /** «Сверка с Маркетом / Ozon / WB». */
  title: string;
  /** Чем сверяется площадка — подзаголовок. */
  subtitle: string;
  /** «Документы Маркета / Ozon / WB». */
  documentsTitle: string;
  /** Пустой список документов — почему. */
  documentsEmpty: string;
  /** Выбор площадки; одна — выбора нет. */
  marketplaceOptions: { value: AccountingMarketplace; label: string }[];
  statusLabel: string;
  tone: ReconcileTone;
  /** «Сверено не всё: …» — у части статей документа нет. */
  partialNote: string | null;
  notes: string[];
  /** «Сверено 08-11-2026 11:24 · данные на 08-11-2026 09:00». */
  stampLabel: string;
  unmatchedLabel: string;
  lines: ReconcileLineRow[];
  documents: ReconcileDocumentRow[];
  storeLevel: ReconcileStoreLevelRow[];
  storeLevelMore: number;
  storeLevelTotalLabel: string;
}

// ─── Заказы «Финучёта» (API — TASK-222, экран — TASK-223) ───────────────────

/** Список и карточка заказов: зонтик + своя подфича (`requires`). */
export const ACCOUNTING_ORDERS_FEATURE = 'fin_accounting_orders';
/** Фоновые задачи магазина (`scope: 'store'`): ключ магазина обязателен. */
export const ACCOUNTING_ORDERS_KIND = 'accounting:orders';
export const ACCOUNTING_ORDER_KIND = 'accounting:order';

export type AccountingMarketplace = 'ym' | 'ozon' | 'wb';
export type OrderProfitState = 'forecast' | 'preliminary' | 'reconciled';
export type OrderAmountSource = 'actual' | 'expected' | 'allocated' | 'unknown';
export type OrderAmountKey =
  | 'revenue'
  | 'commission'
  | 'acquiring'
  | 'delivery'
  | 'reverse_logistics'
  | 'other_services'
  | 'advertising'
  | 'advertising_allocated'
  | 'opex_allocated'
  | 'other_expenses'
  | 'compensations'
  | 'cogs'
  | 'cogs_write_off'
  | 'tax_allocated';
export type OrderProfitReason =
  | 'no-operations'
  | 'no-line-value'
  | 'no-record'
  | 'unconvertible'
  | 'no-product'
  | 'no-sale-moment'
  | 'no-lot'
  | 'no-lines'
  | 'forecast';
export type OrderSnapshotReason = string;

export interface AccountingPeriod {
  from: string;
  to: string;
}

/** Фильтр списка — и запрос, и эхо в ответе. */
export interface AccountingOrdersFilter {
  marketplace: AccountingMarketplace | null;
  state: OrderProfitState | null;
  lossOnly: boolean;
}

/** Запрос списка: магазин (kind магазинный) + месяц оформления «ГГГГ-ММ» + фильтр. */
export interface AccountingOrdersRequest extends AccountingOrdersFilter {
  store: string;
  month: string;
}

/** Запрос карточки: номер уникален только внутри площадки. */
export interface AccountingOrderRequest {
  store: string;
  marketplace: AccountingMarketplace;
  orderId: string;
}

export interface AccountingOrdersRowResponse {
  marketplace: AccountingMarketplace;
  orderId: string;
  createdOn: string | null;
  offerNames: string[];
  units: number;
  revenueKopecks: number | null;
  confirmedKopecks: number;
  expectedKopecks: number;
  netKopecks: number | null;
  state: OrderProfitState;
  stateTitle: string;
  isLoss: boolean;
}

/** Задача `accounting:orders` — заказы месяца оформления. */
export interface AccountingOrdersResponse {
  period: AccountingPeriod;
  costMethod: string;
  marketplaces: AccountingMarketplace[];
  rows: AccountingOrdersRowResponse[];
  totals: {
    count: number;
    lossCount: number;
    confirmedKopecks: number;
    expectedKopecks: number;
    /** Σ известной прибыли; заказы с неизвестной — в `unknownCount`. */
    netKopecks: number;
    unknownCount: number;
  };
  unallocatedKopecks: number;
  filter: AccountingOrdersFilter;
  marketplaceOptions: { marketplace: AccountingMarketplace; label: string }[];
  stateOptions: { key: OrderProfitState; label: string }[];
}

export interface OrderCardOperationResponse {
  id: string;
  title: string;
  kopecks: number;
  accruedOn: string;
  marketplace: AccountingMarketplace;
  documentId: string | null;
  origin: 'journal' | 'manual';
}

export interface OrderCardCostLineResponse {
  itemId: string;
  offerId: string | null;
  offerName: string | null;
  count: number;
  unitKopecks: number | null;
  recordFrom: string | null;
  /** Себестоимость позиции целиком; null — неизвестна. */
  totalKopecks?: number | null;
  /** Режим Б — из каких партий взяты штуки. */
  portions?: { receivedDay: string; units: number; kopecks: number }[];
  reason: string | null;
}

export interface OrderCardAmountResponse {
  key: OrderAmountKey;
  title: string;
  kopecks: number | null;
  source: OrderAmountSource;
  reason: OrderProfitReason | null;
  method: string | null;
  basis: string | null;
  note: string | null;
  operations: OrderCardOperationResponse[];
  costLines?: OrderCardCostLineResponse[];
  allocationPeriod?: AccountingPeriod;
  /** Только у «Прочих расходов» — расходы продавца из «Расходов» (TASK-220). */
  expenses?: { id: string; title: string; kopecks: number; method: string }[];
}

export interface OrderCardLineResponse {
  itemId: string;
  offerId: string | null;
  offerName: string | null;
  count: number;
  priceKopecks: number | null;
  buyerPriceKopecks: number | null;
  marketplaceSubsidyKopecks: number | null;
  revenueKopecks: number | null;
  status: string | null;
  createdOn: string | null;
  soldOn: string | null;
  returnedOn: string | null;
}

/** Задача `accounting:order` — карточка заказа по ТЗ п.4. */
export interface AccountingOrderCardResponse {
  marketplace: AccountingMarketplace;
  marketplaceLabel: string;
  orderId: string;
  createdOn: string | null;
  state: OrderProfitState;
  stateTitle: string;
  stateHint: string;
  final: boolean;
  reconcile: 'reconciled' | 'discrepancy' | 'unknown' | null;
  costMethod: string;
  /** Чем посчитана себестоимость (TASK-215): А, Б или не определена. Не `costMethod`. */
  cogsMethod: OrderCogsMethod;
  cogsMethodTitle: string;
  allocationPeriod: AccountingPeriod;
  prices: {
    buyerKopecks: number | null;
    sellerKopecks: number | null;
    recognizedKopecks: number | null;
    marketplaceDiscountKopecks: number | null;
  };
  amounts: OrderCardAmountResponse[];
  reference: OrderCardOperationResponse[];
  confirmedKopecks: number;
  expectedKopecks: number;
  netKopecks: number | null;
  unknown: { key: OrderAmountKey; reason: OrderProfitReason | null } | null;
  lines: OrderCardLineResponse[];
  snapshot: { version: number; written: boolean; reason: OrderSnapshotReason | null };
  versions: {
    version: number;
    state: OrderProfitState;
    reason: OrderSnapshotReason;
    reasonTitle: string;
    netKopecks: number | null;
    capturedAt: string;
  }[];
}

/** Тон состояния: окончательная — ok, неокончательная — warn (ждёт), не «сломалось». */
export type OrderStateTone = 'ok' | 'warn';

export interface AccountingOrderRow {
  key: string;
  marketplace: AccountingMarketplace;
  orderId: string;
  dayLabel: string;
  offersLabel: string;
  marketplaceLabel: string;
  revenueLabel: string;
  confirmedLabel: string;
  /** null — ожидаемого нет. */
  expectedLabel: string | null;
  /** «Неизвестно» при null, никогда «0 ₽». */
  netLabel: string;
  netUnknown: boolean;
  isLoss: boolean;
  stateLabel: string;
  stateTone: OrderStateTone;
}

export interface AccountingOrdersView {
  rows: AccountingOrderRow[];
  periodLabel: string;
  costMethodLabel: string;
  totals: {
    countLabel: string;
    confirmedLabel: string;
    expectedLabel: string;
    netLabel: string;
    /** «Прибыль заказов» — с пометкой «не окончательная», пока не все заказы сверены. */
    netTitle: string;
    /** Убыточные и неизвестные одной строкой; null — нечего сказать. */
    netCaption: string | null;
    /** «Без 3 заказов с неизвестной закупкой» — null, если таких нет. */
    unknownNote: string | null;
    lossLabel: string | null;
    unallocatedLabel: string | null;
  };
  marketplaceOptions: { value: string; label: string }[];
  stateOptions: { value: string; label: string }[];
}

export type OrderAmountTag = 'expected' | 'allocated' | 'estimate' | 'unknown_cogs' | 'unknown';

export interface OrderOperationRow {
  id: string;
  title: string;
  amountLabel: string;
  dayLabel: string;
  marketplaceLabel: string;
  documentLabel: string;
  manual: boolean;
}

export interface OrderCostLineRow {
  key: string;
  title: string;
  countLabel: string;
  unitLabel: string;
  unknown: boolean;
  note: string | null;
}

export interface OrderAmountRow {
  key: OrderAmountKey;
  title: string;
  amountLabel: string;
  unknown: boolean;
  tags: { tag: OrderAmountTag; label: string }[];
  /** Методика, основание оценки, пометка, причина — подписи под строкой. */
  notes: string[];
  operations: OrderOperationRow[];
  costLines: OrderCostLineRow[];
  /** Есть что раскрыть. */
  expandable: boolean;
}

export interface AccountingOrderCardView {
  title: string;
  subtitle: string;
  stateLabel: string;
  stateHint: string;
  stateTone: OrderStateTone;
  /** Неокончательная — подпись рядом с итогом. */
  provisionalNote: string | null;
  confirmedLabel: string;
  expectedLabel: string;
  netLabel: string;
  netUnknown: boolean;
  /** «Неизвестная закупка: …» — почему чистой нет. */
  unknownNote: string | null;
  isLoss: boolean;
  /** «Себестоимость: Партии закупок (FIFO)» — метка метода (TASK-216). */
  cogsMethodLabel: string;
  amounts: OrderAmountRow[];
  reference: OrderOperationRow[];
  prices: { label: string; value: string }[];
  versions: { key: string; label: string; stateLabel: string; netLabel: string; atLabel: string }[];
}

// ─── Отчёты файлом (TASK-209) ────────────────────────────────────────────────

/** Загрузка отчёта WB «Продвижение»: зонтик + своя подфича (`requires`). */
export const ACCOUNTING_UPLOADS_FEATURE = 'fin_accounting_uploads';

/** Ответ `POST /ym/accounting/uploads/wb-promotion`. */
export type WbPromotionUploadResponse =
  | { status: 'unchanged'; month: string; rows: number }
  | { status: 'imported'; month: string; rows: number; inserted: number; matched: number };

// ─── Партии и режим себестоимости (TASK-216) ─────────────────────────────────

/** Партии, остатки и выбор режима А/Б: зонтик + своя подфича (`requires`). */
export const ACCOUNTING_LOTS_FEATURE = 'fin_accounting_lots';

/** Режим себестоимости: А — закуп из прайса на момент продажи, Б — партии FIFO. */
export type CostMethod = 'historical_price' | 'lot_fifo';

/** Метод себестоимости заказа; `unknown` — не определена. */
export type OrderCogsMethod = CostMethod | 'unknown';

/** Ответ `GET|POST /ym/accounting/cost/settings`. */
export interface CostSettingsResponse {
  method: CostMethod;
  methodTitle: string;
  isDefault: boolean;
  updatedAt: string | null;
  options: { key: CostMethod; label: string }[];
}

/** Партия из `GET /ym/accounting/lots`: остаток — из FIFO сервера, суммы — копейки. */
export interface AccountingLotResponse {
  lotId: string;
  purchaseId: string;
  supplier: string;
  receivedDay: string;
  sku: string;
  name: string | null;
  productMatched: boolean;
  count: number;
  remaining: number;
  unitPriceKopecks: number;
  extraKopecks: number;
  unitCostKopecks: number;
  remainingCostKopecks: number;
}

export interface AccountingLotsResponse {
  lots: AccountingLotResponse[];
  totals: { remaining: number; remainingCostKopecks: number };
}

export interface AccountingLotRow {
  key: string;
  productLabel: string;
  skuLabel: string;
  /** Артикул не сопоставлен с товаром — партия не списывается. */
  unmatchedNote: string | null;
  supplierLabel: string;
  receivedLabel: string;
  countLabel: string;
  remainingLabel: string;
  /** Остатка нет — строка приглушена. */
  soldOut: boolean;
  unitCostLabel: string;
  /** «Закуп 1 000 ₽ + доп. расходы» — только если доп. расходы есть. */
  unitCostNote: string | null;
  remainingCostLabel: string;
}

export interface AccountingLotsView {
  rows: AccountingLotRow[];
  totalsLabel: string;
}

// ─── Возвраты «Финучёта» (TASK-225) ─────────────────────────────────────────

/** Раздел возвратов: зонтик + своя подфича (`requires`). */
export const ACCOUNTING_RETURNS_FEATURE = 'fin_accounting_returns';
/** Фоновая задача магазина: возвраты заказов месяца оформления. */
export const ACCOUNTING_RETURNS_KIND = 'accounting:returns';

/** Запрос: магазин (kind магазинный) + месяц оформления «ГГГГ-ММ». */
export interface AccountingReturnsRequest {
  store: string;
  month: string;
}

/** Колонка площадки; копейки со знаком журнала, null — неизвестно. */
export interface AccountingReturnsMarketplaceResponse {
  marketplace: AccountingMarketplace;
  label: string;
  ordersCount: number;
  returnedCount: number;
  returnRate: number | null;
  returnedValueKopecks: number | null;
  deliveryKopecks: number;
  reverseKopecks: number;
  withheldKopecks: number;
  compensationsKopecks: number;
  writeOffKopecks: number | null;
  repackingKopecks: number;
  resultKopecks: number | null;
  unknownCount: number;
}

export interface AccountingReturnsModelResponse {
  marketplace: AccountingMarketplace;
  label: string;
  offerId: string;
  offerName: string | null;
  returnedUnits: number;
  soldUnits: number;
  returnRate: number | null;
}

export interface AccountingReturnsOrderResponse {
  marketplace: AccountingMarketplace;
  orderId: string;
  title: string;
  returnedOn: string | null;
  logisticsKopecks: number;
  resultKopecks: number | null;
}

export interface AccountingReturnsResponse {
  period: AccountingPeriod;
  marketplaces: AccountingReturnsMarketplaceResponse[];
  models: AccountingReturnsModelResponse[];
  orders: AccountingReturnsOrderResponse[];
}

/** Строка «показатель × площадка»: ячейки в порядке `columns`. */
export interface AccountingReturnsMetricRow {
  key: string;
  title: string;
  hint: string | null;
  cells: string[];
  /** Итоговая строка — выделяется. */
  total: boolean;
}

export interface AccountingReturnsModelRow {
  key: string;
  name: string;
  offerId: string;
  marketplaceLabel: string;
  returnedLabel: string;
  rateLabel: string;
}

export interface AccountingReturnsOrderRow {
  key: string;
  marketplace: AccountingMarketplace;
  orderId: string;
  title: string;
  marketplaceLabel: string;
  dayLabel: string;
  logisticsLabel: string;
  resultLabel: string;
  isLoss: boolean;
}

export interface AccountingReturnsView {
  periodLabel: string;
  columns: { marketplace: AccountingMarketplace; label: string }[];
  /** Хоть один возврат за месяц. */
  hasReturns: boolean;
  metrics: AccountingReturnsMetricRow[];
  models: AccountingReturnsModelRow[];
  orders: AccountingReturnsOrderRow[];
}

// ─── Панель «Финучёта» (TASK-231) ───────────────────────────────────────────

/** Главная учёта: итоги, раскрытие строки и аналитика — зонтик + своя подфича. */
export const ACCOUNTING_DASHBOARD_FEATURE = 'fin_accounting_dashboard';
/** Фоновые задачи магазина (kind-ы бэкенда `crm-accounting.domain.ts`). */
export const ACCOUNTING_DASHBOARD_KIND = 'accounting:dashboard';
export const ACCOUNTING_DASHBOARD_DRILL_KIND = 'accounting:dashboard-drill';
export const ACCOUNTING_ANALYTICS_KIND = 'accounting:analytics';

/** Базис периода: по дате продажи, начисления или движению денег. */
export type DashboardBasis = 'sale' | 'accrual' | 'cash';

/** Строка панели; порядок на экране — порядок `lines` в ответе. */
export type DashboardLine =
  | 'revenue'
  | 'returns'
  | 'compensations'
  | 'cogs'
  | 'commission'
  | 'logistics'
  | 'marketplace_services'
  | 'advertising'
  | 'tax'
  | 'opex';

/** Фильтр панели — и запрос, и эхо в ответе; null — без фильтра. */
export interface DashboardFilter {
  marketplace: AccountingMarketplace | null;
  brand: string | null;
  offerId: string | null;
  orderId: string | null;
}

/** Запрос панели: период всегда диапазоном «с — по» (пресеты пикера — тоже диапазон). */
export interface AccountingDashboardRequest {
  store: string;
  basis: DashboardBasis;
  range: AccountingPeriod;
  filter: DashboardFilter;
}

/** Блок раскрытия: площадка или «Все площадки». */
export type DashboardBlockKey = AccountingMarketplace | 'all';

export interface AccountingDashboardDrillRequest extends AccountingDashboardRequest {
  line: DashboardLine;
  block: DashboardBlockKey;
}

export interface AccountingAnalyticsRequest {
  store: string;
  range: AccountingPeriod;
}

/** Эхо периода: пресет (`key`, `day`) или «с — по» (`range`). */
export interface DashboardPeriodEcho {
  key: string | null;
  day: string | null;
  range: AccountingPeriod | null;
}

export interface DashboardLineTotalResponse {
  line: DashboardLine;
  title: string;
  /** Σ строки; null — хоть одна сумма неизвестна. */
  kopecks: number | null;
  /** Из них ожидаемое (только базис «продажа»). */
  expectedKopecks: number;
  count: number;
  unknownReason: string | null;
}

export interface DashboardBlockResponse {
  /** null — «Все площадки». */
  marketplace: AccountingMarketplace | null;
  label: string;
  lines: DashboardLineTotalResponse[];
  grossKopecks: number | null;
  netKopecks: number | null;
  /** Уже процент, один знак. */
  marginPercent: number | null;
  payableKopecks: number | null;
  receivedKopecks: number | null;
  /** В блоке площадки нет строк уровня кабинета (налог, закуп, общие расходы). */
  excludesAccountLevel: boolean;
}

/** Задача `accounting:dashboard`. */
export interface AccountingDashboardResponse {
  basis: DashboardBasis;
  basisTitle: string;
  basisHint: string;
  period: AccountingPeriod;
  periodEcho: DashboardPeriodEcho;
  filter: DashboardFilter;
  marketplaces: AccountingMarketplace[];
  totals: {
    byMarketplace: DashboardBlockResponse[];
    /** «Все площадки» — только когда сервер её собрал; сами площадки не складываем. */
    all: DashboardBlockResponse | null;
  };
  payableAsOf: string | null;
  filterNote: string | null;
  sync: {
    asOf: string | null;
    marketplaces: {
      marketplace: AccountingMarketplace;
      label: string;
      lastSuccessAt: string | null;
    }[];
  };
  basisOptions: { key: string; label: string }[];
  marketplaceOptions: { marketplace: AccountingMarketplace; label: string }[];
  brandOptions: { key: string; label: string }[];
}

export interface DashboardDrillOrderResponse {
  marketplace: AccountingMarketplace;
  orderId: string;
  title: string;
  kopecks: number | null;
  expected: boolean;
  reason: string | null;
}

export interface DashboardDrillRecordResponse {
  source: 'journal' | 'manual' | 'order' | 'expense' | 'purchase' | 'tax';
  id: string;
  title: string;
  kopecks: number | null;
}

/** Задача `accounting:dashboard-drill`: из чего строка итогов. */
export interface AccountingDashboardDrillResponse {
  basis: DashboardBasis;
  basisTitle: string;
  period: AccountingPeriod;
  periodEcho: DashboardPeriodEcho;
  line: DashboardLine;
  title: string;
  marketplace: AccountingMarketplace | null;
  label: string;
  kopecks: number | null;
  operations: OrderCardOperationResponse[];
  operationsTotal: number;
  orders: DashboardDrillOrderResponse[];
  ordersTotal: number;
  records: DashboardDrillRecordResponse[];
}

export interface AnalyticsProductResponse {
  marketplace: AccountingMarketplace;
  label: string;
  offerId: string;
  offerName: string | null;
  ordersCount: number;
  units: number;
  profitKopecks: number | null;
  unknownCount: number;
}

export interface AnalyticsAverageResponse {
  ordersCount: number;
  avgKopecks: number | null;
  /** Доля от выручки, со знаком журнала. */
  shareOfRevenue: number | null;
}

export interface AnalyticsMarketplaceDataResponse {
  marketplace: AccountingMarketplace;
  label: string;
  insufficientData: false;
  ordersCount: number;
  revenueKopecks: number | null;
  profitKopecks: number | null;
  unknownCount: number;
  /** Доля, не процент. */
  margin: number | null;
  commission: AnalyticsAverageResponse;
  logistics: AnalyticsAverageResponse;
}

export interface AnalyticsMarketplaceMissingResponse {
  marketplace: AccountingMarketplace;
  label: string;
  insufficientData: true;
  reason: string;
}

export type AnalyticsMarketplaceResponse =
  | AnalyticsMarketplaceDataResponse
  | AnalyticsMarketplaceMissingResponse;

export interface AnalyticsDayResponse {
  day: string;
  marketplace: AccountingMarketplace;
  ordersCount: number;
  profitKopecks: number | null;
  unknownCount: number;
}

/** Задача `accounting:analytics` — заказы, оформленные в периоде. */
export interface AccountingAnalyticsResponse {
  period: AccountingPeriod;
  periodEcho: DashboardPeriodEcho;
  products: {
    mostProfitable: AnalyticsProductResponse[];
    leastProfitable: AnalyticsProductResponse[];
    unknownModels: number;
    multiModelOrders: number;
  };
  lossOrders: {
    orders: {
      marketplace: AccountingMarketplace;
      label: string;
      orderId: string;
      title: string;
      createdOn: string | null;
      resultKopecks: number;
    }[];
    total: number;
  };
  returnModels: {
    models: {
      marketplace: AccountingMarketplace;
      label: string;
      offerId: string;
      offerName: string | null;
      returnedOrders: number;
      returnedUnits: number;
      resultKopecks: number | null;
    }[];
    multiModelReturns: number;
  };
  marketplaces: AnalyticsMarketplaceResponse[];
  days: AnalyticsDayResponse[];
}

/** Состояние числа: факт по журналу, оценка (есть ожидаемое) или неизвестно. */
export type DashboardCellState = 'fact' | 'estimate' | 'unknown';

export interface DashboardCell {
  text: string;
  state: DashboardCellState;
  /** Пояснение к числу: сколько ожидается, почему неизвестно. */
  note: string | null;
  /** Ячейку можно раскрыть до операций (строка панели, не итог). */
  line: DashboardLine | null;
  block: DashboardBlockKey;
}

export interface DashboardRow {
  key: string;
  title: string;
  hint: string | null;
  cells: DashboardCell[];
  /** Итоговая строка — выделяется. */
  total: boolean;
}

export interface DashboardColumn {
  block: DashboardBlockKey;
  label: string;
  /** Сноска: строк уровня кабинета в блоке площадки нет. */
  note: string | null;
}

export interface AccountingDashboardView {
  basisTitle: string;
  basisHint: string;
  periodLabel: string;
  columns: DashboardColumn[];
  rows: DashboardRow[];
  /** Почему часть строк не вошла при фильтре — текст сервера. */
  filterNote: string | null;
  freshnessLabel: string;
  freshness: { marketplace: AccountingMarketplace; label: string; text: string }[];
  basisOptions: { value: DashboardBasis; label: string }[];
  marketplaceOptions: { value: string; label: string }[];
  brandOptions: { key: string; label: string }[];
  hasEstimate: boolean;
  hasUnknown: boolean;
}

export interface DashboardDrillOperationRow {
  key: string;
  title: string;
  dayLabel: string;
  marketplaceLabel: string;
  documentLabel: string | null;
  manual: boolean;
  amountLabel: string;
}

export interface DashboardDrillOrderRow {
  key: string;
  marketplace: AccountingMarketplace;
  orderId: string;
  title: string;
  amountLabel: string;
  note: string | null;
  expected: boolean;
}

export interface DashboardDrillRecordRow {
  key: string;
  title: string;
  sourceLabel: string;
  amountLabel: string;
}

export interface AccountingDashboardDrillView {
  title: string;
  subtitle: string;
  totalLabel: string;
  operations: DashboardDrillOperationRow[];
  operationsNote: string | null;
  orders: DashboardDrillOrderRow[];
  ordersNote: string | null;
  records: DashboardDrillRecordRow[];
  isEmpty: boolean;
}

export interface AnalyticsCompareRow {
  key: string;
  title: string;
  hint: string | null;
  cells: string[];
  total: boolean;
}

export interface AnalyticsProductRow {
  key: string;
  name: string;
  offerId: string;
  marketplaceLabel: string;
  ordersLabel: string;
  profitLabel: string;
  isLoss: boolean;
}

export interface AnalyticsLossOrderRow {
  key: string;
  marketplace: AccountingMarketplace;
  orderId: string;
  title: string;
  marketplaceLabel: string;
  dayLabel: string;
  resultLabel: string;
}

export interface AnalyticsReturnModelRow {
  key: string;
  name: string;
  offerId: string;
  marketplaceLabel: string;
  returnedLabel: string;
  resultLabel: string;
}

export interface AnalyticsChartSeries {
  key: AccountingMarketplace;
  label: string;
  tone: 'c1' | 'c2' | 'c3';
}

export interface AnalyticsChartPoint {
  key: string;
  label: string;
  hint: string;
  /** null — прибыль дня неизвестна: на графике разрыв, не ноль. */
  values: Record<string, number | null>;
}

export interface AccountingAnalyticsView {
  periodLabel: string;
  columns: { marketplace: AccountingMarketplace; label: string }[];
  /** Площадки без данных — причина словами вместо чисел. */
  missing: { marketplace: AccountingMarketplace; label: string; reason: string }[];
  compare: AnalyticsCompareRow[];
  series: AnalyticsChartSeries[];
  points: AnalyticsChartPoint[];
  unknownDaysNote: string | null;
  mostProfitable: AnalyticsProductRow[];
  leastProfitable: AnalyticsProductRow[];
  productsNotes: string[];
  lossOrders: AnalyticsLossOrderRow[];
  lossOrdersNote: string | null;
  returnModels: AnalyticsReturnModelRow[];
  returnModelsNote: string | null;
  multiColumn: boolean;
}

/* ── История закупа v2 (TASK-213 бэкенд, TASK-235 экран) ───────────────── */

/**
 * Закуп записи — та же форма, что у «Товаров»: цена поставщика до скидки бренда,
 * валюта, курс, доп. расходы. Себестоимость из него считает сервер.
 */
export type CostPurchase = ProductPurchase;

/** Откуда запись: прайс, ручное исправление, перенос из истории «Товаров». */
export type CostSource = 'price-list' | 'manual' | 'cost-history';

export type CostChangeAction = 'insert' | 'correct';

/** Запись: с какого момента (ISO) действует закуп. */
export interface CostRecord {
  id: string;
  validFrom: string;
  purchase: CostPurchase;
  source: CostSource;
  /** Подпись источника — с сервера. */
  sourceLabel: string;
  author: string | null;
}

export interface CostValue {
  validFrom: string;
  purchase: CostPurchase;
}

/** Строка журнала исправлений: было/стало, автор, причина. */
export interface CostChange {
  id: string;
  action: CostChangeAction;
  actionLabel: string;
  before: CostValue | null;
  after: CostValue;
  author: string;
  impersonatedBy: string | null;
  reason: string;
  createdAt: string;
}

export interface CostHistoryView {
  records: CostRecord[];
  changes: CostChange[];
}

/** Товар в поиске истории закупа: только чтобы выбрать. */
export interface CostProductOption {
  id: string;
  internalSku: string;
  name: string | null;
}

export interface CostProductsResponse {
  total: number;
  items: CostProductOption[];
  currencies: string[];
}

/** Поле формы исправления — те же ключи, что `field` в ответе 400. */
export type CostCorrectionField =
  | 'validFrom'
  | 'price'
  | 'currency'
  | 'rate'
  | 'extraCosts'
  | 'reason';

/** Форма исправления: строки, как набрал продавец. */
export interface CostCorrectionForm {
  /** «ГГГГ-ММ-ДДTЧЧ:ММ» по Москве — значение `datetime-local`. */
  validFrom: string;
  /**
   * Точный момент исправляемой записи (ISO): поле минутное, а запись прайса —
   * с секундами. Пока момент в поле не трогали, уходит он — иначе вместо
   * исправления записи завелась бы новая рядом с ней.
   */
  exactValidFrom: string | null;
  price: string;
  currency: string;
  rate: string;
  extraCosts: string;
  reason: string;
}

export interface CostCorrectionBody {
  validFrom: string;
  price: string;
  currency: string;
  rate: string | null;
  extraCosts: string | null;
  reason: string;
}

export type CostCorrectionErrors = Partial<Record<CostCorrectionField | 'form', string>>;

export const COST_CORRECTION_ERROR_CODE = {
  INVALID: 'INVALID_COST_CORRECTION',
  NOT_FOUND: 'COST_PRODUCT_NOT_FOUND',
} as const;

/** Как `MAX_CORRECTION_REASON_LENGTH` сервера: поле не даст набрать больше. */
export const COST_REASON_MAX_LENGTH = 500;

/** Запись в таблице — подписи готовы. */
export interface CostRecordRow {
  id: string;
  momentLabel: string;
  purchaseLabel: string;
  sourceLabel: string;
  authorLabel: string;
}

/** Строка журнала в списке. */
export interface CostChangeRow {
  id: string;
  actionLabel: string;
  createdLabel: string;
  /** `null` — записи до правки не было. */
  beforeLabel: string | null;
  afterLabel: string;
  authorLabel: string;
  reason: string;
}
