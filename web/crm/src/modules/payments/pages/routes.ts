import type { RouteRecordRaw } from 'vue-router';

/** Раздел магазина (`/ym/stores/:store/payments`); имя — ключ пункта меню `ym-payments`. */
export const paymentsRoutes: RouteRecordRaw[] = [
  {
    path: 'payments',
    name: 'ym-payments',
    component: () => import('@/modules/payments/pages/PaymentsPage.vue'),
    meta: { title: 'Платежи' },
  },
];
