import type {
  StoreItem,
  StoresResponse,
  StoreView,
  StoreViewResponse,
  TokenReplaced,
  TokenReplacedResponse,
} from '../stores.domain';

import { mapStoreItem, mapStoreView, mapTokenReplaced } from '../mappers/mapStores.stores';

import { http } from '@/shared/http';

const BASE = '/ym/stores';

export const storesApi = {
  list: async (): Promise<StoreItem[]> =>
    (await http.get<StoresResponse>(BASE)).stores.map(mapStoreItem),

  view: async (key: string): Promise<StoreView> =>
    mapStoreView(await http.get<StoreViewResponse>(`${BASE}/${encodeURIComponent(key)}`)),

  /** Токен сначала проверяется в Маркете; отказ оставляет прежний. */
  replaceToken: async (token: string): Promise<TokenReplaced> =>
    mapTokenReplaced(await http.put<TokenReplacedResponse>(`${BASE}/token`, { token })),
};
