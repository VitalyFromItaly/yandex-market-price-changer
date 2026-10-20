import type {
  LinkBody,
  MarketplaceKey,
  ProductCard,
  ProductCardResponse,
  ProductsPage,
  ProductsQuery,
  ProductsResponse,
  PurchaseBody,
  UnmatchedPage,
  UnmatchedResponse,
} from '../products.domain';

import { PRODUCTS_PAGE_SIZE } from '../constants/tabs.products';
import { mapProductsPage, mapUnmatchedPage } from '../mappers/mapProducts.products';

import { http } from '@/shared/http';

const BASE = '/ym/products';
const id = (value: string) => encodeURIComponent(value);

/** Записи отвечают свежей карточкой: экран рисуется с сервера, не с формы. */
export const productsApi = {
  list: async (query: ProductsQuery, limit = PRODUCTS_PAGE_SIZE): Promise<ProductsPage> => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(limit) });
    if (query.q.length > 0) params.set('q', query.q);
    if (query.brand.length > 0) params.set('brand', query.brand);
    return mapProductsPage(await http.get<ProductsResponse>(`${BASE}?${params.toString()}`));
  },

  card: (productId: string): Promise<ProductCard> =>
    http.get<ProductCardResponse>(`${BASE}/${id(productId)}`),

  updatePurchase: (productId: string, body: PurchaseBody): Promise<ProductCard> =>
    http.put<ProductCardResponse>(`${BASE}/${id(productId)}/purchase`, body),

  link: (productId: string, body: LinkBody): Promise<ProductCard> =>
    http.post<ProductCardResponse>(`${BASE}/${id(productId)}/links`, body),

  unlink: (productId: string, marketplace: MarketplaceKey): Promise<ProductCard> =>
    http.delete<ProductCardResponse>(`${BASE}/${id(productId)}/links/${id(marketplace)}`),

  unmatched: async (page: number): Promise<UnmatchedPage> =>
    mapUnmatchedPage(await http.get<UnmatchedResponse>(`${BASE}/unmatched?page=${page}`)),
};
