import type { RouteRecordRaw } from 'vue-router';

import { PRICE_SET_ROUTE_NAME } from '../price-set.domain';

import { sectionPath } from '@/navigation.sections';

/** «Установка цен» — раздел аккаунта (`/ym/price-set`): цены пишутся на площадки, не в магазин. */
export const priceSetRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'price-set'),
    name: PRICE_SET_ROUTE_NAME,
    component: () => import('@/modules/price-set/pages/PriceSetPage.vue'),
    meta: { title: 'Установка цен' },
  },
];
