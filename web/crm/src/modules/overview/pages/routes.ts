import type { RouteRecordRaw } from 'vue-router';

import { OVERVIEW_ROUTE_NAME } from '../overview.domain';

/** «Обзор» — раздел аккаунта; имя — ключ пункта меню `ym-overview`. */
export const overviewRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/overview',
    name: OVERVIEW_ROUTE_NAME,
    component: () => import('@/modules/overview/pages/OverviewPage.vue'),
    meta: { title: 'Обзор' },
  },
];
