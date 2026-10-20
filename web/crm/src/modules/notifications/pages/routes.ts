import type { RouteRecordRaw } from 'vue-router';

import { NOTIFICATIONS_ROUTE_NAME } from '../notifications.domain';

/** Раздел аккаунта; имя — ключ пункта меню `ym-notifications`. */
export const notificationsRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/notifications/:tab?',
    name: NOTIFICATIONS_ROUTE_NAME,
    component: () => import('@/modules/notifications/pages/NotificationsPage.vue'),
    meta: { title: 'Уведомления' },
  },
];
