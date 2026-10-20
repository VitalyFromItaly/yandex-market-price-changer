import type { RouteRecordRaw } from 'vue-router';

import { QUARANTINE_ROUTE_NAME } from '../quarantine.domain';

/** Раздел магазина (`/ym/stores/:store/quarantine`); имя — ключ пункта `ym-quarantine`. */
export const quarantineRoutes: RouteRecordRaw[] = [
  {
    path: 'quarantine',
    name: QUARANTINE_ROUTE_NAME,
    component: () => import('@/modules/quarantine/pages/QuarantinePage.vue'),
    meta: { title: 'Карантин цен' },
  },
];
