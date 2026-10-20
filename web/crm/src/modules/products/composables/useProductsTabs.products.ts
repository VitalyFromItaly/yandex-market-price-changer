import { computed } from 'vue';

import { PRODUCTS_TABS } from '../constants/tabs.products';
import { PRODUCTS_ROUTE_NAME } from '../products.domain';

import { useRouteTabs } from '@/shared/composables';

/** Вкладка — в URL (`/ym/products/:tab?`): F5 возвращает в ту же. */
export function useProductsTabs() {
  const open = computed(() => PRODUCTS_TABS);
  return { open, ...useRouteTabs(PRODUCTS_ROUTE_NAME, 'tab', open) };
}
