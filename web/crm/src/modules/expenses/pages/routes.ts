import type { RouteRecordRaw } from 'vue-router';

import { sectionPath } from '@/navigation.sections';

/** Имя — ключ пункта меню `ym-expenses`: маршрут вытесняет заглушку раздела. */
export const expensesRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'expenses'),
    name: 'ym-expenses',
    component: () => import('@/modules/expenses/pages/ExpensesPage.vue'),
    meta: { title: 'Расходы' },
  },
];
