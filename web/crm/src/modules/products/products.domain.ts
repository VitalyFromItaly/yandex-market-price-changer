import type { MarketplaceKey } from '@/navigation';

/**
 * Раздел «Товары» (TASK-118): товары продавца, себестоимость и её история,
 * карточки площадок, ручная правка закупа и очередь «не сопоставлено».
 * Себестоимость считает сервер той же функцией, что «Прибыль» и «Прайс»;
 * фронт только показывает.
 */

export const PRODUCTS_ROUTE_NAME = 'ym-products';
export const PRODUCT_ROUTE_NAME = 'ym-products-item';

export type ProductsTabKey = 'list' | 'unmatched';

export interface ProductsTabMeta {
  key: ProductsTabKey;
  label: string;
}

export type { MarketplaceKey };

/** Закуп как его хранит сервер: цена до скидки бренда. */
export interface ProductPurchase {
  price: number;
  /** RUR, USD, EUR, CNY. */
  currency: string;
  rate: number | null;
  extraCosts: number | null;
}

export interface BrandOption {
  /** Ключ бренда или `none` — без бренда. */
  key: string;
  title: string;
  count: number;
}

export interface ProductListItem {
  id: string;
  internalSku: string;
  name: string | null;
  vendor: string | null;
  brandTitle: string | null;
  purchase: ProductPurchase | null;
  /** Себестоимость на сегодня; `null` — неизвестна. */
  cost: number | null;
  marketplaceSkus: Record<MarketplaceKey, string | null>;
}

export interface ProductsResponse {
  total: number;
  totalAll: number;
  page: number;
  limit: number;
  brands: BrandOption[];
  items: ProductListItem[];
  currencies: string[];
}

export interface ProductsPage {
  total: number;
  /** Товаров у продавца всего — отличает «ничего не нашлось» от «товаров нет». */
  totalAll: number;
  page: number;
  pages: number;
  brands: BrandOption[];
  items: ProductListItem[];
}

export interface ProductsQuery {
  q: string;
  /** Ключ бренда; пусто — все. */
  brand: string;
  page: number;
}

export interface CostHistoryEntry {
  /** ГГГГ-ММ-ДД; `null` — стартовая, «с начала времён». */
  validFrom: string | null;
  purchase: ProductPurchase | null;
  source: string | null;
  sourceText: string | null;
  author: string | null;
}

export interface ProductLink {
  marketplace: MarketplaceKey;
  label: string;
  sku: string | null;
  source: string | null;
  sourceText: string | null;
  linkedAt: string | null;
  salePrice: number | null;
}

export interface ProductCardResponse {
  id: string;
  internalSku: string;
  name: string | null;
  category: string | null;
  vendor: string | null;
  vendorCode: string | null;
  barcodes: string[];
  brandTitle: string | null;
  purchase: ProductPurchase | null;
  cost: number | null;
  purchaseUpdatedAt: string | null;
  history: CostHistoryEntry[];
  links: ProductLink[];
  currencies: string[];
}

export type ProductCard = ProductCardResponse;

export interface UnmatchedCandidate {
  productId: string;
  internalSku: string | null;
  name: string | null;
}

export interface UnmatchedCard {
  marketplace: MarketplaceKey;
  sku: string;
  name: string | null;
  reason: string;
  reasonText: string;
  levelText: string | null;
  candidates: UnmatchedCandidate[];
  detectedAt: string;
}

export interface UnmatchedResponse {
  total: number;
  page: number;
  limit: number;
  items: UnmatchedCard[];
}

export interface UnmatchedPage {
  total: number;
  page: number;
  pages: number;
  items: UnmatchedCard[];
}

/** Форма правки закупа: строки, как набрал продавец. */
export interface PurchaseForm {
  price: string;
  currency: string;
  rate: string;
  extraCosts: string;
}

export interface PurchaseBody {
  price: string;
  currency: string;
  rate: string | null;
  extraCosts: string | null;
}

export type PurchaseErrors = Partial<Record<keyof PurchaseForm | 'form', string>>;

/** Привязка карточки площадки к товару. */
export interface LinkBody {
  marketplace: MarketplaceKey;
  sku: string;
}
