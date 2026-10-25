import type { RouteRecordRaw } from 'vue-router';

import { sectionPath } from '@/navigation.sections';

/** Имя — ключ пункта меню `ym-taxes`: маршрут вытесняет заглушку раздела. */
export const taxesRoutes: RouteRecordRaw[] = [
  {
    path: `${sectionPath('ym', 'taxes')}/:tab?`,
    name: 'ym-taxes',
    component: () => import('@/modules/taxes/pages/TaxesPage.vue'),
    meta: { title: 'Налоги' },
  },
];
