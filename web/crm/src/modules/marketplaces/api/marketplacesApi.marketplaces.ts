import type {
  ConnectionCard,
  ConnectionCardsResponse,
  ConnectionCheckResponse,
  ConnectionCheckResult,
  MarketplaceConnection,
  MarketplacesResponse,
  OzonConnectionResponse,
  OzonCredentialsInput,
  TokenReplaced,
  TokenReplacedResponse,
} from '../marketplaces.domain';
import type { MarketplaceKey } from '@/navigation';

import {
  mapConnectionCards,
  mapConnectionCheck,
  mapMarketplaces,
  mapOzonConnection,
  mapTokenReplaced,
} from '../mappers/mapMarketplaces.marketplaces';

import { http } from '@/shared/http';

/** Площадки продавца — уровень аккаунта, вне сегмента `/ym`. */
export const marketplacesApi = {
  list: async (): Promise<MarketplaceConnection[]> =>
    mapMarketplaces(await http.get<MarketplacesResponse>('/marketplaces')),
  /** Ключ Ozon проверяется у Ozon до записи; отказ — ApiError с кодом. */
  connectOzon: async (input: OzonCredentialsInput): Promise<MarketplaceConnection | null> =>
    mapOzonConnection(await http.put<OzonConnectionResponse>('/ozon/connection', input)),
  /** Токен WB проверяется у WB по категориям до записи; отказ — ApiError с кодом. */
  connectWb: async (token: string): Promise<void> => {
    await http.put<unknown>('/wb/connection', { token });
  },
  /** Токен ЯМ сначала проверяется в Маркете; отказ оставляет прежний. */
  replaceYmToken: async (token: string): Promise<TokenReplaced> =>
    mapTokenReplaced(await http.put<TokenReplacedResponse>('/ym/stores/token', { token })),
  /** «Подключения»: карточки площадок с маской ключа. */
  cards: async (): Promise<ConnectionCard[]> =>
    mapConnectionCards(await http.get<ConnectionCardsResponse>('/connections')),
  /** Повторная проверка записанного ключа — сам ключ не меняется. */
  check: async (key: MarketplaceKey): Promise<ConnectionCheckResult> =>
    mapConnectionCheck(
      await http.post<ConnectionCheckResponse>(`/connections/${encodeURIComponent(key)}/check`),
    ),
};
