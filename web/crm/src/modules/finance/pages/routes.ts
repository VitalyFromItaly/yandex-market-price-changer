import type { RouteRecordRaw } from 'vue-router';

/** Имя — ключ пункта меню `ym-finance`: маршрут вытесняет заглушку раздела. */
export const financeRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/finance/:tab?',
    name: 'ym-finance',
    component: () => import('@/modules/finance/pages/FinancePage.vue'),
    meta: { title: 'Финансы' },
  },
  // ДДС жил вкладкой «Закупок» (TASK-122) — старая ссылка ведёт на его новое место.
  { path: '/ym/purchases/cashflow', redirect: '/ym/finance/cashflow' },
];
