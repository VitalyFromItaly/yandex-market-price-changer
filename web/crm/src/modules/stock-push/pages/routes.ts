import type { RouteRecordRaw } from 'vue-router';

import { STOCK_PUSH_ROUTE_NAME } from '../stock-push.domain';

/** «Передача остатков» — раздел аккаунта; имя — ключ пункта меню `ym-stock-push`. */
export const stockPushRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/stock-push',
    name: STOCK_PUSH_ROUTE_NAME,
    component: () => import('@/modules/stock-push/pages/StockPushPage.vue'),
    meta: { title: 'Передача остатков' },
  },
];
