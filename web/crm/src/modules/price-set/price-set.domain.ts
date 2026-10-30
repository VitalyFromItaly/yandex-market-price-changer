/**
 * «Установка цен» CRM (TASK-203): цены на площадки — наценкой от закупа по
 * площадке или файлом «артикул | цена». План — фоновая задача `price-set:plan`
 * (наценка — POST /jobs, файл — POST /ym/price-set/upload), запись —
 * POST /ym/price-set/apply. Числа, риск и «что запишется» решает сервер
 * (`ICrmPriceSet` в src/modules/crm/price-set/crm-price-set.domain.ts).
 */

export const PRICE_SET_ROUTE_NAME = 'ym-price-set';
export const PRICE_SET_KIND = 'price-set:plan';

/** Раздел открыт фичей `price_set`; наценка — только при открытом закупе из прайса. */
export const PRICE_SET_FEATURE = 'price_set';
export const PURCHASE_PRICES_FEATURE = 'purchase_prices';

export type PriceSetMarketplace = 'ym' | 'ozon' | 'wb';

export const PRICE_SET_MARKETPLACES: readonly PriceSetMarketplace[] = ['ym', 'ozon', 'wb'];

export const MARKETPLACE_LABEL: Record<PriceSetMarketplace, string> = {
  ym: 'Яндекс Маркет',
  ozon: 'Ozon',
  wb: 'Wildberries',
};

/** Коды ошибок сервера. */
export const PRICE_SET_ERROR = {
  INVALID_FILE: 'INVALID_FILE',
  PLAN_RUNNING: 'PLAN_RUNNING',
  PRICE_SET_RUNNING: 'PRICE_SET_RUNNING',
} as const;

/** Те же лимиты, что на сервере: проверка до отправки экономит 10 МБ трафика. */
export const PRICE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const PRICE_FILE_EXTENSIONS: readonly string[] = ['.xlsx', '.xls', '.csv'];
export const PRICE_FILE_ACCEPT = PRICE_FILE_EXTENSIONS.join(',');

/** Наценка — процент от закупа (PRICE_SET_MARKUP_MIN/MAX сервера). */
export const MARKUP_MIN = 1;
export const MARKUP_MAX = 10_000;
/** Закуп для примера под полем: «1000 ₽ → 2500 ₽». */
export const MARKUP_EXAMPLE_PURCHASE = 1000;

export type PriceSetMode = 'markup' | 'file';

export const PRICE_SET_MODE_OPTIONS: readonly { value: PriceSetMode; label: string }[] = [
  { value: 'markup', label: 'Наценка от закупа' },
  { value: 'file', label: 'Файл с ценами' },
];

export type PriceSetBlock = 'read-error' | 'no-markup' | 'no-write-method';

export interface PriceSetRow {
  /** `площадка:артикул` — ключ снятия галочки и поля `excluded`. */
  key: string;
  sku: string;
  mpSku: string;
  name: string | null;
  /** `null` — текущей цены нет. */
  from: number | null;
  to: number;
  /** Δ в процентах до десятых; `null` — сравнить не с чем. */
  deltaPct: number | null;
  /** |Δ| > 50% или без текущей цены — по умолчанию снята. */
  risky: boolean;
}

export interface PriceSetTarget {
  marketplace: PriceSetMarketplace;
  marketplaceLabel: string;
  blockedBy: PriceSetBlock | null;
  blockedText: string | null;
  error: string | null;
  updates: PriceSetRow[];
  unchanged: number;
  skipped: { sku: string; name: string | null; reason: string; reasonText: string }[];
  /** Запись открыта, нет блокировки, есть изменения. */
  willWrite: boolean;
}

/** `data` задачи плана — `ICrmPriceSet` без `request` (его веб не читает). */
export interface PriceSetPlan {
  takenAt: string;
  source: PriceSetMode;
  planHash: string;
  /** ISO: когда загружали прайс с закупом; `null` — ни разу. */
  priceListAt: string | null;
  writeOpen: boolean;
  /** Сколько уйдёт, если ничего не снимать (risky уже не считаны). */
  writeCount: number;
  notes: readonly string[];
  notConsidered: { marketplaceLabel: string; reason: string }[];
  fileBad: { row: number; sku: string | null; reasonText: string }[];
  targets: PriceSetTarget[];
}

export type PriceSetMarkups = Partial<Record<PriceSetMarketplace, number>>;

/** Запрос плана — повторяется кнопкой «Повторить». */
export type PlanRequest =
  | { source: 'markup'; markups: PriceSetMarkups }
  | { source: 'file'; file: File; marketplaces: PriceSetMarketplace[] };

export interface PriceSetApplyRequest {
  planJobId: string;
  planHash: string;
  marketplaces: readonly PriceSetMarketplace[];
  excluded: readonly string[];
}

export interface PriceSetWrite {
  marketplace: PriceSetMarketplace;
  requested: number;
  written: number;
  errors: { batch: number; message: string }[];
  skipped: { sku: string; reason: string }[];
  skipReason?: 'write-disabled' | 'no-access';
}

export interface PriceSetApplyResult {
  writes: PriceSetWrite[];
}

/** Ошибки формы плана: под полем файла или общая. */
export interface PlanErrors {
  file: string | null;
  form: string | null;
  /** Уже считается план — его id, чтобы подхватить опрос. */
  runningJobId: string | null;
}

/** Строка формы наценки: площадка, галочка и введённый процент. */
export interface MarkupRow {
  marketplace: PriceSetMarketplace;
  label: string;
  on: boolean;
  text: string;
}

/** Статус карточки площадки — одна подпись и один цвет на смысл. */
export interface TargetStatus {
  label: string;
  variant: 'ok' | 'warn' | 'danger' | 'default';
}
