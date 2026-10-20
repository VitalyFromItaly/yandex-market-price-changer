import type { RouteRecordRaw } from 'vue-router';

/** Имя — ключ пункта меню `ym-taxes`: маршрут вытесняет заглушку раздела. */
export const taxesRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/taxes/:tab?',
    name: 'ym-taxes',
    component: () => import('@/modules/taxes/pages/TaxesPage.vue'),
    meta: { title: 'Налоги' },
  },
];
