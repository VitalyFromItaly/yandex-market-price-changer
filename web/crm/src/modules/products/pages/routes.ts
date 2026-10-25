import type { RouteRecordRaw } from 'vue-router';

import { PRODUCT_ROUTE_NAME, PRODUCTS_ROUTE_NAME } from '../products.domain';

import { sectionPath } from '@/navigation.sections';

/**
 * Имя списка — ключ пункта меню `ym-products`: маршрут вытесняет заглушку
 * раздела. Карточка — свой адрес (`/ym/products/item/:id`), чтобы ссылка и F5
 * вели в тот же товар; два сегмента не совпадают с `:tab?` списка.
 */
export const productsRoutes: RouteRecordRaw[] = [
  {
    path: `${sectionPath('ym', 'products')}/:tab?`,
    name: PRODUCTS_ROUTE_NAME,
    component: () => import('@/modules/products/pages/ProductsPage.vue'),
    meta: { title: 'Товары' },
  },
  {
    path: `${sectionPath('ym', 'products')}/item/:id`,
    name: PRODUCT_ROUTE_NAME,
    component: () => import('@/modules/products/pages/ProductPage.vue'),
    meta: { title: 'Товар' },
  },
];
