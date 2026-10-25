import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Склад» — раздел площадки: `/<площадка>/inventory`, имя `<площадка>-inventory` — ключ пункта меню. */
export function inventoryRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'inventory',
      () => import('@/modules/inventory/pages/InventoryPage.vue'),
      'Склад',
    ),
  ];
}
