import type { RouteRecordRaw } from 'vue-router';

import { MARKETPLACES_DASHBOARD_ROUTE_NAME } from '../marketplaces-dashboard.domain';

import { sectionPath } from '@/navigation.sections';

/** Дашборд «Площадки» — раздел аккаунта; имя — ключ пункта меню `ym-marketplaces-dashboard`. */
export const marketplacesDashboardRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'marketplaces-dashboard'),
    name: MARKETPLACES_DASHBOARD_ROUTE_NAME,
    component: () => import('@/modules/marketplaces-dashboard/pages/MarketplacesDashboardPage.vue'),
    meta: { title: 'Площадки' },
  },
];
