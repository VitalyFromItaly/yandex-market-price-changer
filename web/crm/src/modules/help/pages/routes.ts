import type { RouteRecordRaw } from 'vue-router';

/** Имя — ключ пункта меню `help`: маршрут вытесняет заглушку раздела. */
export const helpRoutes: RouteRecordRaw[] = [
  {
    path: '/help',
    name: 'help',
    component: () => import('@/modules/help/pages/HelpPage.vue'),
    meta: { title: 'Помощь' },
  },
];
