import type { MarketplaceKey } from '@/navigation';

/**
 * Типы и константы блоков «Топ товаров», «На исходе» и «Unit-экономика по
 * площадкам» главной. Реэкспортируются из dashboard.domain.ts.
 */

// --- товары и остатки --------------------------------------------------------

/** Ответ `stocks:by-sku`: остаток по артикулу, порог «на исходе» — с сервера. */
export interface StocksResponse {
  /** FBY — «на исходе» ведёт в «FBY», иначе в «Прайс». */
  fby: boolean;
  takenAt: string | null;
  threshold: number;
  stocks: Record<string, number> | null;
  /** Почему остатков нет — текст бота без значка. */
  problem: string | null;
}

/** Строк в «Топе товаров». */
export const TOP_SKU_LIMIT = 10;
/** Строк в «На исходе». */
export const LOW_STOCK_LIMIT = 5;
/**
 * Остаток в «Топе» жёлтым — до стольких штук включительно (выше — зелёным,
 * до порога «на исходе» — красным). Решение crm_unit_economics_platforms.
 */
export const STOCK_WARN_LIMIT = 10;

/** Строка «Unit-экономики по площадкам»: null у полей — площадка ещё не подключена. */
export interface UnitEconomicsRow {
  key: MarketplaceKey;
  label: string;
  /** Числа есть только у ЯМ (ответ — прибыль магазина ЯМ); прочие — приглушённые строки. */
  active: boolean;
  sales: string | null;
  commission: string | null;
  commissionShare: string | null;
  tax: string | null;
  taxShare: string | null;
  purchase: string | null;
  net: string | null;
  margin: string | null;
  tone: ProductTone;
}

export type ProductTone = 'neutral' | 'ok' | 'warn' | 'danger';

/** Таблетка по тону строки товара — остаток и маржа в таблицах главной. */
export const PRODUCT_TONE_PILL: Record<ProductTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  ok: 'bg-ok/15 text-ok ring-1 ring-inset ring-ok/30',
  warn: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/30',
  danger: 'bg-danger/15 text-danger ring-1 ring-inset ring-danger/30',
};

/** Места топа: первые три — цветные кружки, дальше — приглушённые. */
export const RANK_CLASS: readonly string[] = [
  'bg-gradient-to-br from-chart-4 to-chart-2 text-white shadow-[0_0_12px_-2px_hsl(var(--chart-4)/0.7)]',
  'bg-gradient-to-br from-chart-1 to-chart-6 text-white shadow-[0_0_12px_-2px_hsl(var(--chart-1)/0.6)]',
  'bg-gradient-to-br from-chart-2 to-chart-5 text-white shadow-[0_0_12px_-2px_hsl(var(--chart-2)/0.6)]',
];
export const RANK_REST_CLASS = 'bg-muted text-muted-foreground';

/** Цвет текста по тону строки товара. */
export const PRODUCT_TONE_CLASS: Record<ProductTone, string> = {
  neutral: '',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
};

/** Строка «Топа товаров», готовая к показу. */
export interface TopSkuRow {
  sku: string;
  name: string;
  /** null — остаток неизвестен (источник ещё идёт или упал): «—», не ноль. */
  stock: string | null;
  stockTone: ProductTone;
  sold: string;
  revenue: string;
  margin: string | null;
  tone: ProductTone;
  returns: string;
}

/** Строка «На исходе». */
export interface LowStockRow {
  sku: string;
  name: string;
  stock: string;
  sold: string;
  /** Ноль — нечего продавать, а не «мало». */
  out: boolean;
}
