import type { ICostRecord, TCostSource } from './cost-history.domain';
import type { IProductPurchase, TLinkSource, TMarketplace } from './product.domain';
import type { TBrandKey } from '../yandex/reports/brands';

import { MARKETPLACE_LABEL, MARKETPLACES } from '../../shared/marketplace';
import { BRAND_KEYS, brandOf, brandTitle } from '../yandex/reports/brands';

import { MATCH_LEVEL_LABEL } from './product.domain';

/**
 * Раздел CRM «Товары» (TASK-118) — чистые правила списка и карточки, без Nest.
 *
 * Чисел здесь нет: себестоимость считает `costOn` (cost-history.domain.ts) —
 * та же функция, что у «Прибыли» и колонки «Закуп» «Прайса».
 */

/** Фильтр бренда: ключ реестра или «без бренда» — скидка по умолчанию. */
export type TBrandFilter = TBrandKey | 'none';

export const BRAND_FILTER_NONE = 'none';

/** Потолок страницы списка: таблица, а не выгрузка. */
export const PRODUCT_PAGE_MAX = 100;
export const PRODUCT_PAGE_DEFAULT = 50;

/** Подписи источника записи истории себестоимости. */
export const COST_SOURCE_LABEL: Record<TCostSource, string> = {
  baseline: 'Стартовая',
  'price-list': 'Прайс',
  manual: 'Ручная правка',
};

/** Подписи источника привязки карточки к товару. */
export const LINK_SOURCE_LABEL: Record<TLinkSource, string> = {
  seed: 'по прайсу',
  barcode: `по совпадению: ${MATCH_LEVEL_LABEL.barcode}`,
  vendorCode: `по совпадению: ${MATCH_LEVEL_LABEL.vendorCode}`,
  sku: `по совпадению: ${MATCH_LEVEL_LABEL.sku}`,
  manual: 'вручную',
};

/** Товар в объёме, нужном поиску и фильтру. */
export interface ISearchableProduct {
  internalSku: string;
  name?: string;
  category?: string;
  vendorCode?: string;
  marketplaceSkus?: Partial<Record<TMarketplace, string>>;
}

export function isBrandFilter(value: unknown): value is TBrandFilter {
  return value === BRAND_FILTER_NONE || (BRAND_KEYS as readonly unknown[]).includes(value);
}

/**
 * Подходит ли товар под поиск и бренд. Поиск — подстрока без регистра по
 * внутреннему артикулу, названию, артикулу производителя и артикулам площадок:
 * продавец ищет тем кодом, который у него перед глазами. Бренд — `brandOf`
 * при чтении: в базе его нет (копия разошлась бы с реестром скидок).
 */
export function matchesProduct(
  product: ISearchableProduct,
  query: { q?: string; brand?: TBrandFilter | null },
): boolean {
  if (query.brand) {
    const brand = brandOf({ name: product.name, category: product.category });
    if (query.brand === BRAND_FILTER_NONE ? brand !== null : brand !== query.brand) return false;
  }

  const needle = query.q?.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    product.internalSku,
    product.name,
    product.vendorCode,
    ...MARKETPLACES.map((mp) => product.marketplaceSkus?.[mp]),
  ];
  return haystack.some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
  );
}

/** Бренды товаров продавца со счётчиком — опции фильтра; «без бренда» последним. */
export function brandCounts(
  products: readonly { name?: string; category?: string }[],
): { key: TBrandFilter; title: string; count: number }[] {
  const counts = new Map<TBrandFilter, number>();
  for (const product of products) {
    const key = brandOf({ name: product.name, category: product.category }) ?? BRAND_FILTER_NONE;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: { key: TBrandFilter; title: string; count: number }[] = [];
  for (const key of BRAND_KEYS) {
    const count = counts.get(key);
    if (count) result.push({ key, title: brandTitle(key), count });
  }
  const none = counts.get(BRAND_FILTER_NONE);
  if (none) result.push({ key: BRAND_FILTER_NONE, title: 'Без бренда', count: none });
  return result;
}

/** Страница и размер из query: мусор — умолчания, размер не выше потолка. */
export function pageOf(page: unknown, limit: unknown): { page: number; limit: number } {
  const p = Math.trunc(Number(page));
  const l = Math.trunc(Number(limit));
  return {
    page: Number.isFinite(p) && p > 0 ? p : 1,
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, PRODUCT_PAGE_MAX) : PRODUCT_PAGE_DEFAULT,
  };
}

/** Закуп для экрана: валюта всегда названа, пустые поля — `null`. */
export function purchaseView(purchase: IProductPurchase | null | undefined): {
  price: number;
  currency: string;
  rate: number | null;
  extraCosts: number | null;
} | null {
  if (!purchase) return null;
  const currency = purchase.currency?.trim().toUpperCase();
  return {
    price: purchase.price,
    currency: !currency || currency === 'RUB' ? 'RUR' : currency,
    rate: purchase.rate ?? null,
    extraCosts: purchase.extraCosts ?? null,
  };
}

/** История для экрана: новые записи сверху, стартовая — последней. */
export function historyView(history: readonly ICostRecord[]) {
  return [...history]
    .sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''))
    .map((record) => ({
      validFrom: record.validFrom,
      purchase: purchaseView(record),
      source: record.source ?? null,
      sourceText: record.source ? COST_SOURCE_LABEL[record.source] : null,
      author: record.author ?? null,
    }));
}

/** Привязки площадок для экрана — все три площадки, пустые тоже: «не привязана» видно. */
export function linksView(product: {
  marketplaceSkus?: Partial<Record<TMarketplace, string>>;
  marketplaceLinks?: Partial<Record<TMarketplace, { source?: TLinkSource; linkedAt?: Date }>>;
  salePrices?: Partial<Record<TMarketplace, number>>;
}) {
  return MARKETPLACES.map((marketplace) => {
    const link = product.marketplaceLinks?.[marketplace];
    return {
      marketplace,
      label: MARKETPLACE_LABEL[marketplace],
      sku: product.marketplaceSkus?.[marketplace] ?? null,
      source: link?.source ?? null,
      sourceText: link?.source ? LINK_SOURCE_LABEL[link.source] : null,
      linkedAt: link?.linkedAt ?? null,
      salePrice: product.salePrices?.[marketplace] ?? null,
    };
  });
}
