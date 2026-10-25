import type { RouteRecordRaw } from 'vue-router';

import { NOTIFICATIONS_ROUTE_NAME } from '../notifications.domain';

import { sectionPath } from '@/navigation.sections';

/** Раздел аккаунта; имя — ключ пункта меню `ym-notifications`. */
export const notificationsRoutes: RouteRecordRaw[] = [
  {
    path: `${sectionPath('ym', 'notifications')}/:tab?`,
    name: NOTIFICATIONS_ROUTE_NAME,
    component: () => import('@/modules/notifications/pages/NotificationsPage.vue'),
    meta: { title: 'Уведомления' },
  },
];
