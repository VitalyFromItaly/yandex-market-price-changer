import type { RouteRecordRaw } from 'vue-router';

import { INVENTORY_ROUTE_NAME } from '../inventory.domain';

/** «Склад» — раздел аккаунта; имя — ключ пункта меню `ym-inventory`. */
export const inventoryRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/inventory',
    name: INVENTORY_ROUTE_NAME,
    component: () => import('@/modules/inventory/pages/InventoryPage.vue'),
    meta: { title: 'Склад' },
  },
];
