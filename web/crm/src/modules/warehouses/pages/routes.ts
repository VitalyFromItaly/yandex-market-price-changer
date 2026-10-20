import type { RouteRecordRaw } from 'vue-router';

import { WAREHOUSES_ROUTE_NAME } from '../warehouses.domain';

/** Раздел магазина (`/ym/stores/:store/warehouses`); имя — ключ пункта меню. */
export const warehousesRoutes: RouteRecordRaw[] = [
  {
    path: 'warehouses',
    name: WAREHOUSES_ROUTE_NAME,
    component: () => import('@/modules/warehouses/pages/WarehousesPage.vue'),
    meta: { title: 'Склады' },
  },
];
