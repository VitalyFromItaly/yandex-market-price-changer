import type { RouteRecordRaw } from 'vue-router';

import { AUTH_ROUTE } from '../constants/routeNames.auth';

/** Маршруты без шелла: пока пароль не сменён, сайдбара нет вовсе. */
export const authPublicRoutes: RouteRecordRaw[] = [
  {
    path: AUTH_ROUTE.LOGIN.path,
    name: AUTH_ROUTE.LOGIN.name,
    component: () => import('@/modules/auth/pages/LoginPage.vue'),
    meta: { public: true, title: 'Вход' },
  },
  {
    path: AUTH_ROUTE.FORCE_PASSWORD.path,
    name: AUTH_ROUTE.FORCE_PASSWORD.name,
    component: () => import('@/modules/auth/pages/ForcePasswordPage.vue'),
    meta: { title: 'Смена пароля' },
  },
];
