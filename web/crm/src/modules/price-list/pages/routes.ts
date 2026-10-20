import type { RouteRecordRaw } from 'vue-router';

import { PRICE_LIST_ROUTE_NAME } from '../price-list.domain';

/** Раздел магазина (`/ym/stores/:store/price-list`); имя — ключ пункта `ym-price-list`. */
export const priceListRoutes: RouteRecordRaw[] = [
  {
    path: 'price-list/:tab?',
    name: PRICE_LIST_ROUTE_NAME,
    component: () => import('@/modules/price-list/pages/PriceListPage.vue'),
    meta: { title: 'Прайс' },
  },
];
