import type { RouteRecordRaw } from 'vue-router';

import { SKU_RATINGS_ROUTE_NAME } from '../sku-ratings.domain';

/** «Рейтинги и классификации» — раздел аккаунта; имя — ключ пункта меню `ym-sku-ratings`. */
export const skuRatingsRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/sku-ratings',
    name: SKU_RATINGS_ROUTE_NAME,
    component: () => import('@/modules/sku-ratings/pages/SkuRatingsPage.vue'),
    meta: { title: 'Рейтинги товаров' },
  },
];
