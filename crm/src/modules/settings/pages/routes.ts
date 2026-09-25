import type { RouteRecordRaw } from 'vue-router';

/** Имя — ключ пункта меню `ym-settings`: маршрут вытесняет заглушку раздела. */
export const settingsRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/settings',
    name: 'ym-settings',
    component: () => import('@/modules/settings/pages/SettingsPage.vue'),
    meta: { title: 'Настройки' },
  },
];
