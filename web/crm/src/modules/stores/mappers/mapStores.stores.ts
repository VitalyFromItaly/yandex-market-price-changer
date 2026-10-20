import type { StoreItem, StoreItemResponse, StoreView, StoreViewResponse } from '../stores.domain';

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
