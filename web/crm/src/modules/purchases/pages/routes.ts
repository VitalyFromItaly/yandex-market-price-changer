import type { RouteRecordRaw } from 'vue-router';

import { sectionPath } from '@/navigation.sections';

/** Имя — ключ пункта меню `ym-purchases`: маршрут вытесняет заглушку раздела. */
export const purchasesRoutes: RouteRecordRaw[] = [
  {
    path: sectionPath('ym', 'purchases'),
    name: 'ym-purchases',
    component: () => import('@/modules/purchases/pages/PurchasesPage.vue'),
    meta: { title: 'Закупки' },
  },
  // ДДС жил вкладкой «Закупок» (TASK-122) — старая ссылка ведёт на его новое место.
  {
    path: `${sectionPath('ym', 'purchases')}/cashflow`,
    redirect: `${sectionPath('ym', 'finance')}/cashflow`,
  },
];
