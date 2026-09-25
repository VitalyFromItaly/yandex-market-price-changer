import type { RouteRecordRaw } from 'vue-router';

import { RECOMMENDATIONS_ROUTE_NAME } from '../recommendations.domain';

/** Раздел магазина (`/ym/stores/:store/recommendations`); имя — ключ пункта меню. */
export const recommendationsRoutes: RouteRecordRaw[] = [
  {
    path: 'recommendations',
    name: RECOMMENDATIONS_ROUTE_NAME,
    component: () => import('@/modules/recommendations/pages/RecommendationsPage.vue'),
    meta: { title: 'Рекомендации цен' },
  },
];
