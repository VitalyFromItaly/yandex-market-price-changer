import type { RouteRecordRaw } from 'vue-router';

import { STORE_PARAM, STORES_ROUTE_NAME } from '../stores.domain';

/** Список магазинов — стартовая CRM; имя — ключ пункта меню `ym-stores`. */
export const storesRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/stores',
    name: STORES_ROUTE_NAME,
    component: () => import('@/modules/stores/pages/StoresPage.vue'),
    meta: { title: 'Магазины' },
  },
];

/**
 * Магазин, в который провалились: обёртка грузит его вид и держит отчёты
 * разных магазинов раздельно. Разделы внутри (главная, отчёты, прибыль,
 * прайс) приходят из своих модулей — их `routes.ts` с относительными путями.
 */
export function storeRoutes(children: RouteRecordRaw[]): RouteRecordRaw[] {
  return [
    {
      path: `/ym/stores/:${STORE_PARAM}`,
      component: () => import('@/modules/stores/pages/StoreLayout.vue'),
      children,
    },
  ];
}
