import type { RouteRecordRaw } from 'vue-router';

import { ORDER_FEED_ROUTE_NAME } from '../order-feed.domain';

/** «Лента заказов» — раздел аккаунта; имя — ключ пункта меню `ym-order-feed`. */
export const orderFeedRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/order-feed',
    name: ORDER_FEED_ROUTE_NAME,
    component: () => import('@/modules/order-feed/pages/OrderFeedPage.vue'),
    meta: { title: 'Лента заказов' },
  },
];
