import type { RouteRecordRaw } from 'vue-router';

import { SALES_ANALYTICS_ROUTE_NAME } from '../sales-analytics.domain';

/** «Аналитика продаж» — раздел аккаунта; имя — ключ пункта меню `ym-sales-analytics`. */
export const salesAnalyticsRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/sales-analytics',
    name: SALES_ANALYTICS_ROUTE_NAME,
    component: () => import('@/modules/sales-analytics/pages/SalesAnalyticsPage.vue'),
    meta: { title: 'Аналитика продаж' },
  },
];
