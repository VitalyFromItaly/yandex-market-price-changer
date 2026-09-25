import type { RouteRecordRaw } from 'vue-router';

import { ORDERS_ROUTE_NAME } from '../composables/useOrdersTabs.orders';

/** Раздел магазина (`/ym/stores/:store/orders`); имя — ключ пункта меню `ym-orders`. */
export const ordersRoutes: RouteRecordRaw[] = [
  {
    path: 'orders/:report?',
    name: ORDERS_ROUTE_NAME,
    component: () => import('@/modules/orders/pages/OrdersPage.vue'),
    meta: { title: 'Отчёты' },
  },
];
