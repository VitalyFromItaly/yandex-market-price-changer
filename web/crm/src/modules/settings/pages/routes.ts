import type { RouteRecordRaw } from 'vue-router';

import { sectionPath } from '@/navigation.sections';

/** Имя — ключ пункта меню `ym-settings`: маршрут вытесняет заглушку раздела. */
export const settingsRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'settings'),
    name: 'ym-settings',
    component: () => import('@/modules/settings/pages/SettingsPage.vue'),
    meta: { title: 'Настройки' },
  },
];
