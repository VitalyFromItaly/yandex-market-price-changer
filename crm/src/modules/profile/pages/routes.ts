import type { RouteRecordRaw } from 'vue-router';

import { PROFILE_ROUTE_NAME } from '../profile.domain';

/** Имя — ключ пункта меню `profile`: маршрут вытесняет заглушку раздела. */
export const profileRoutes: RouteRecordRaw[] = [
  {
    path: '/profile/:tab?',
    name: PROFILE_ROUTE_NAME,
    component: () => import('@/modules/profile/pages/ProfilePage.vue'),
    meta: { title: 'Профиль' },
  },
];
