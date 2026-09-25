/**
 * «Прайс» CRM: загрузка файла (остатки + закупочные цены) и список закупа.
 * Ответы — /api/crm/ym/price-list/*; итог загрузки — фоновая задача, её опрос
 * идёт через /api/crm/ym/jobs/:id (общий useJob).
 */

export const PRICE_LIST_ROUTE_NAME = 'ym-price-list';

/** Фичи бота: закуп из прайса и остатки из прайса. */
export const PURCHASE_PRICES_FEATURE = 'purchase_prices';
export const STOCK_UPDATE_FEATURE = 'stock_update';

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
    features: [STOCK_UPDATE_FEATURE, PURCHASE_PRICES_FEATURE],
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
  skipped: SkippedRow[];
  errors: Array<{ batch: number; count: number; message: string }>;
}

export interface PurchasePriceResponseItem {
  sku: string;
  name: string | null;
  category: string | null;
  price: number;
  cost: number;
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
  /** Закуп после скидки бренда — чем считает «Прибыль». */
  cost: number;
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
