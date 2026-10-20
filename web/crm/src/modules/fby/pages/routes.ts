import type { RouteRecordRaw } from 'vue-router';

import { FBY_ROUTE_NAME } from '../fby.domain';

/** Раздел магазина (`/ym/stores/:store/fby`); имя — ключ пункта меню. */
export const fbyRoutes: RouteRecordRaw[] = [
  {
    path: 'fby',
    name: FBY_ROUTE_NAME,
    component: () => import('@/modules/fby/pages/FbyPage.vue'),
    meta: { title: 'FBY' },
  },
];
