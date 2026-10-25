import type { RouteRecordRaw } from 'vue-router';

import { STOCK_PUSH_ROUTE_NAME } from '../stock-push.domain';

import { sectionPath } from '@/navigation.sections';

/** «Передача остатков» — раздел аккаунта; имя — ключ пункта меню `ym-stock-push`. */
export const stockPushRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'stock-push'),
    name: STOCK_PUSH_ROUTE_NAME,
    component: () => import('@/modules/stock-push/pages/StockPushPage.vue'),
    meta: { title: 'Передача остатков' },
  },
];
