import type { RouteRecordRaw } from 'vue-router';

import { PROFIT_ROUTE_NAME } from '../composables/useProfitTabs.profit';

/** Раздел магазина (`/ym/stores/:store/profit`); имя — ключ пункта меню `ym-profit`. */
export const profitRoutes: RouteRecordRaw[] = [
  {
    path: 'profit/:report?',
    name: PROFIT_ROUTE_NAME,
    component: () => import('@/modules/profit/pages/ProfitPage.vue'),
    meta: { title: 'Прибыль' },
  },
];
