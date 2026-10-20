import type { RouteRecordRaw } from 'vue-router';

import { DASHBOARD_ROUTE_NAME } from '../dashboard.domain';

/** Главная магазина — корень `/ym/stores/:store`; имя — ключ пункта `ym-dashboard`. */
export const dashboardRoutes: RouteRecordRaw[] = [
  {
    path: '',
    name: DASHBOARD_ROUTE_NAME,
    component: () => import('@/modules/dashboard/pages/DashboardPage.vue'),
    meta: { title: 'Главная' },
  },
];
