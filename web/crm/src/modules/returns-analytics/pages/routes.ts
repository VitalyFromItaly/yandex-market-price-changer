import type { RouteRecordRaw } from 'vue-router';

import { RETURNS_ANALYTICS_ROUTE_NAME } from '../returns-analytics.domain';

/** «Аналитика возвратов» — раздел аккаунта; имя — ключ пункта меню `ym-returns-analytics`. */
export const returnsAnalyticsRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/returns-analytics',
    name: RETURNS_ANALYTICS_ROUTE_NAME,
    component: () => import('@/modules/returns-analytics/pages/ReturnsAnalyticsPage.vue'),
    meta: { title: 'Аналитика возвратов' },
  },
];
