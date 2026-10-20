import type { RouteRecordRaw } from 'vue-router';

import { AI_ANALYST_ROUTE_NAME } from '../ai-analyst.domain';

/**
 * «ИИ-аналитик» — раздел аккаунта: журнал бизнесовый, магазина у вопроса нет.
 * Вкладки «Чат» и «Разбор периода» (TASK-150) — в параметре пути.
 */
export const aiAnalystRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/ai-analyst/:tab?',
    name: AI_ANALYST_ROUTE_NAME,
    component: () => import('@/modules/ai-analyst/pages/AiAnalystPage.vue'),
    meta: { title: 'ИИ-аналитик' },
  },
];
