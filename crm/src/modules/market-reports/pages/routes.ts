import type { RouteRecordRaw } from 'vue-router';

import { MARKET_REPORTS_ROUTE_NAME } from '../market-reports.domain';

/** Раздел магазина (`/ym/stores/:store/market-reports`); имя — ключ пункта меню `ym-market-reports`. */
export const marketReportsRoutes: RouteRecordRaw[] = [
  {
    path: 'market-reports/:report?',
    name: MARKET_REPORTS_ROUTE_NAME,
    component: () => import('@/modules/market-reports/pages/MarketReportsPage.vue'),
    meta: { title: 'Отчёты Маркета' },
  },
];
