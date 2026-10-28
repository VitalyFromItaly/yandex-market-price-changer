/**
 * «Прайс» CRM: загрузка файла (остатки + закупочные цены), план записи остатков
 * на площадки («Передача остатков», при открытой `stock_push`) и список закупа.
 * Ответы — /api/crm/ym/price-list/* и /api/crm/ym/stock-push/apply; итоги —
 * фоновые задачи, их опрос идёт через /api/crm/jobs/:id (общий useJob).
 */

export const PRICE_LIST_ROUTE_NAME = 'ym-price-list';

/** Фичи бота: закуп из прайса и остатки из прайса. */
export const PURCHASE_PRICES_FEATURE = 'purchase_prices';
export const STOCK_UPDATE_FEATURE = 'stock_update';
/** План «Передачи остатков»: с ним файл остатки не пишет — их пишет план по площадкам. */
export const STOCK_PUSH_FEATURE = 'stock_push';

export const PRICE_LIST_TAB = {
  UPLOAD: 'upload',
  PRICES: 'prices',
} as const;

export type PriceListTabKey = (typeof PRICE_LIST_TAB)[keyof typeof PRICE_LIST_TAB];

export interface PriceListTabMeta {
  key: PriceListTabKey;
  label: string;
  /** Открыта, если открыта ЛЮБАЯ из фич. */
  features: readonly string[];
}

export const PRICE_LIST_TABS: readonly PriceListTabMeta[] = [
  {
    key: PRICE_LIST_TAB.UPLOAD,
    label: 'Загрузка',
    features: [STOCK_UPDATE_FEATURE, PURCHASE_PRICES_FEATURE, STOCK_PUSH_FEATURE],
  },
  { key: PRICE_LIST_TAB.PRICES, label: 'Закупочные цены', features: [PURCHASE_PRICES_FEATURE] },
];

/** Коды ошибок загрузки с сервера. */
export const UPLOAD_ERROR = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE: 'INVALID_FILE',
  UPLOAD_RUNNING: 'UPLOAD_RUNNING',
} as const;

/** Те же лимиты, что на сервере (UPLOAD_LIMITS): проверка до отправки экономит 10 МБ трафика. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ACCEPT = '.xlsx,.xls';

export type UploadWarningCode = 'stock-feature-off' | 'fby' | 'placement-unknown' | 'prices-off';

/** POST /upload → 202. */
export interface UploadAcceptedResponse {
  jobId: string;
  warning: { code: UploadWarningCode; text: string } | null;
  progress: string;
  ahead: number;
}

export interface UploadAccepted {
  jobId: string;
  /** Предупреждение до обработки: на FBY остатки не пишутся и т.п. */
  warning: string | null;
  progress: string;
  /** Сколько файлов впереди в общей с ботом очереди. */
  ahead: number;
}

export interface SkippedRow {
  name: string;
  category: string;
  rowNumber: number;
  reason: string;
}

/** `data` задачи загрузки — вид `ICrmStockView` бэкенда. */
export interface StockSyncData {
  headline: string;
  explanation: string | null;
  advice: string | null;
  dryRun: boolean;
  writeSkipReason: string | null;
  placementType: string | null;
  totalRows: number;
  catalogSize: number;
  matched: number;
  zeroed: number;
  /** `null` — записи не было и не должно было быть. */
  updated: number | null;
  /** Остатки файл не писал — их пишет план ниже. Нет у задач до плана на «Прайсе». */
  stocksByPlan?: boolean;
  /** Товары с закупом из файла и привязанные из них к Ozon/WB; `null` — не считали. */
  purchaseCoverage?: PurchaseCoverage | null;
  purchasePricesSaved: number;
  purchasePricesSkipped: boolean;
  matchedBy: Record<string, number>;
  skipped: SkippedRow[];
  errors: Array<{ batch: number; skus: string[]; message: string }>;
}

export interface StockSyncCount {
  label: string;
  value: number;
  /** Строка про сбой или снятие с продажи — выделяется. */
  tone: 'default' | 'warn' | 'danger';
}

/** Итог загрузки для экрана. */
export interface StockSyncResult {
  headline: string;
  /** Запись в Маркет прошла без сбоев. */
  success: boolean;
  explanation: string | null;
  advice: string | null;
  counts: StockSyncCount[];
  pricesSkippedNote: string | null;
  /** Остатки запишет план на этой же странице. */
  stocksByPlan: boolean;
  purchaseCoverage: PurchaseCoverage | null;
  skipped: SkippedRow[];
  errors: Array<{ batch: number; count: number; message: string }>;
}

export interface PurchasePriceResponseItem {
  sku: string;
  name: string | null;
  category: string | null;
  price: number;
  cost: number | null;
  updatedAt: string | null;
}

export interface PurchasePricesResponse {
  items: PurchasePriceResponseItem[];
  total: number;
  page: number;
  limit: number;
  lastUpdatedAt: string | null;
}

export interface PurchasePrice {
  sku: string;
  name: string | null;
  category: string | null;
  /** Цена в прайсе. */
  price: number;
  /** Себестоимость на сегодня — чем считает «Прибыль»; `null` — неизвестна. */
  cost: number | null;
}

export interface PurchasePricesPage {
  items: PurchasePrice[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** «24-09-2026» — когда прайс загружали; `null` — ни разу. */
  lastUpdated: string | null;
}

export interface PurchasePricesQuery {
  q: string;
  page: number;
}

export const PURCHASE_PRICES_PAGE_SIZE = 50;

/** Ошибки формы загрузки: под полем файла или общая. */
export interface UploadErrors {
  file: string | null;
  form: string | null;
  /** Уже идёт загрузка — её id, чтобы подхватить опрос. */
  runningJobId: string | null;
}

/** Закуп один на товар: Ozon и WB видят его через привязку карточки к товару. */
export interface PurchaseCoverage {
  products: number;
  ozon: number;
  wb: number;
}

/* ── План «Передачи остатков» (TASK-143): свой склад − продано после прайса ── */

export const STOCK_PUSH_KIND = 'stock-push:plan';
export const PUSH_RUNNING = 'PUSH_RUNNING';

export type StockPushMarketplace = 'ym' | 'ozon' | 'wb';

export type StockPushBlock =
  | 'placement'
  | 'read-error'
  | 'orders-unknown'
  | 'own-orders-unknown'
  | 'zeroing'
  | 'no-warehouse'
  | 'several-warehouses'
  | 'no-write-method';

export interface StockPushRow {
  internalSku: string;
  name: string | null;
  sku: string;
  from: number;
  to: number;
  priceListStock: number;
  sold: number;
}

export interface StockPushTarget {
  marketplace: StockPushMarketplace;
  marketplaceLabel: string;
  key: string;
  name: string;
  placement: string | null;
  blockedBy: StockPushBlock | null;
  blockedText: string | null;
  error: string | null;
  updates: StockPushRow[];
  zeroed: number;
  unchanged: number;
  notListed: number;
  /** Площадка не примет (WB — несколько размеров или нет штрихкода). */
  notWritable: number;
  willWrite: boolean;
}

export interface StockPushPlan {
  takenAt: string;
  priceListDay: string | null;
  planHash: string;
  writeOpen: boolean;
  writeCount: number;
  ruleText: string;
  notes: string[];
  /** `blocksAll: false` — сбой закрывает только свою площадку (WB), остальные пишутся. */
  orderErrors: { marketplaceLabel: string; source: string; error: string; blocksAll: boolean }[];
  notConsidered: { marketplaceLabel: string; reason: string }[];
  targets: StockPushTarget[];
  skipped: { internalSku: string; name: string | null; reason: string; reasonText: string }[];
}

export interface StockPushWrite {
  marketplace: StockPushMarketplace;
  key: string;
  name: string;
  requested: number;
  written: number;
  errors: { batch: number; message: string }[];
  /** Позиции, которые площадке не отправлялись (WB — несколько размеров). */
  skipped: { sku: string; reason: string }[];
  skipReason?: 'placement' | 'write-disabled' | 'feature-disabled';
}

export interface StockPushApplyResult {
  writes: StockPushWrite[];
}

/** Статус карточки площадки — одна подпись и один цвет на смысл. */
export interface TargetStatus {
  label: string;
  variant: 'ok' | 'warn' | 'danger' | 'default';
}

/** Площадка в плане — строка выбора «куда записать». */
export interface PushMarketplaceOption {
  marketplace: StockPushMarketplace;
  label: string;
  /** Есть что записать и запись открыта — галочку можно поставить. */
  writable: boolean;
  /** Позиций к записи по всем её целям (у ЯМ — магазинам). */
  count: number;
  targets: StockPushTarget[];
}
