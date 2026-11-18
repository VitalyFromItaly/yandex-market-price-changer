import type { RouteRecordRaw } from 'vue-router';

import { TOP_SKUS_ROUTE_NAME } from '../top-skus.domain';

/** Раздел магазина (`/ym/stores/:store/top-skus/:tab?`); имя — ключ пункта меню `ym-top-skus`. */
export const topSkusRoutes: RouteRecordRaw[] = [
  {
    path: 'top-skus/:tab?',
    name: TOP_SKUS_ROUTE_NAME,
    component: () => import('@/modules/top-skus/pages/TopSkusPage.vue'),
    meta: { title: 'Топ товаров' },
  },
];
