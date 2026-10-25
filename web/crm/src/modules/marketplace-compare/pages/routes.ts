import type { RouteRecordRaw } from 'vue-router';

import { MARKETPLACE_COMPARE_ROUTE_NAME } from '../marketplace-compare.domain';

import { sectionPath } from '@/navigation.sections';

/** «Сравнение площадок» — раздел аккаунта; имя — ключ пункта меню `ym-marketplace-compare`. */
export const marketplaceCompareRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'marketplace-compare'),
    name: MARKETPLACE_COMPARE_ROUTE_NAME,
    component: () => import('@/modules/marketplace-compare/pages/MarketplaceComparePage.vue'),
    meta: { title: 'Сравнение площадок' },
  },
];
