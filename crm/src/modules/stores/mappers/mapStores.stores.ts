import type {
  StoreItem,
  StoreItemResponse,
  StoreView,
  StoreViewResponse,
  TokenReplaced,
  TokenReplacedResponse,
} from '../stores.domain';

export function mapStoreItem(response: StoreItemResponse): StoreItem {
  return {
    key: response.key,
    label: response.label,
    businessName: response.businessName.length > 0 ? response.businessName : null,
    placementType: response.placementType,
  };
}

export function mapStoreView(response: StoreViewResponse): StoreView {
  return { ...mapStoreItem(response), sections: [...response.sections] };
}

export function mapTokenReplaced(response: TokenReplacedResponse): TokenReplaced {
  return { stores: response.stores.map(mapStoreItem), botStore: response.botStore };
}

/** Текст тоста после смены токена: говорит, если в боте сменился активный магазин. */
export function tokenReplacedText(result: TokenReplaced): string {
  return result.botStore === null
    ? 'Список магазинов обновлён.'
    : `Прежний магазин новому токену недоступен — в боте активным стал «${result.botStore}».`;
}
