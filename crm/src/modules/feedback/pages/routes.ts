import type { RouteRecordRaw } from 'vue-router';

import { FEEDBACK_ROUTE_NAME } from '../feedback.domain';

/** Раздел магазина (`/ym/stores/:store/feedback`); имя — ключ пункта `ym-feedback`. */
export const feedbackRoutes: RouteRecordRaw[] = [
  {
    path: 'feedback',
    name: FEEDBACK_ROUTE_NAME,
    component: () => import('@/modules/feedback/pages/FeedbackPage.vue'),
    meta: { title: 'Отзывы' },
  },
];
