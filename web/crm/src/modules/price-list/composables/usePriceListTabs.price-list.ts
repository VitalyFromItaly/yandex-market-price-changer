import type { PriceListTabMeta } from '../price-list.domain';

import { computed } from 'vue';

import { PRICE_LIST_ROUTE_NAME, PRICE_LIST_TABS, STOCK_UPDATE_FEATURE } from '../price-list.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useRouteTabs } from '@/shared/composables';

/**
 * Вкладки, открытые продавцу. Раздел виден, если открыта хоть одна фича
 * прайса (CRM_SECTIONS: purchase_prices ИЛИ stock_update); список закупа —
 * только под purchase_prices, иначе он вёл бы в 403.
 */
export function openPriceListTabs(
  features: Record<string, boolean> | undefined,
): PriceListTabMeta[] {
  return PRICE_LIST_TABS.filter((tab) => tab.features.some((key) => features?.[key] === true));
}

/** Активная вкладка — в URL (`/ym/stores/:store/price-list/:tab?`), см. useRouteTabs. */
export function usePriceListTabs() {
  const auth = useAuthStore();

  const open = computed(() => openPriceListTabs(auth.me?.features));
  const { active, activeKey } = useRouteTabs(PRICE_LIST_ROUTE_NAME, 'tab', open);

  /**
   * Пойдут ли остатки в Маркет, насколько это известно фронту: фича открыта.
   * Модель (FBY) знает только сервер — он и предупредит; подтверждение перед
   * возможной записью лишним не бывает.
   */
  const stockUpdateOpen = computed(() => auth.me?.features[STOCK_UPDATE_FEATURE] === true);

  return { open, active, activeKey, stockUpdateOpen };
}
