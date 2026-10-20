import type { RouteRecordRaw } from 'vue-router';

import { UNIT_ECONOMICS_ROUTE_NAME } from '../unit-economics.domain';

/** «Unit-экономика» — раздел аккаунта; имя — ключ пункта меню `ym-unit-economics`. */
export const unitEconomicsRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/unit-economics',
    name: UNIT_ECONOMICS_ROUTE_NAME,
    component: () => import('@/modules/unit-economics/pages/UnitEconomicsPage.vue'),
    meta: { title: 'Unit-экономика' },
  },
];
