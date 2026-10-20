import type { RouteRecordRaw } from 'vue-router';

/** Имя — ключ пункта меню `ym-purchases`: маршрут вытесняет заглушку раздела. */
export const purchasesRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/purchases',
    name: 'ym-purchases',
    component: () => import('@/modules/purchases/pages/PurchasesPage.vue'),
    meta: { title: 'Закупки' },
  },
];
