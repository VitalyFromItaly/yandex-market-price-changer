import type { RouteRecordRaw } from 'vue-router';

import { ACCOUNTING_ROUTE_NAME } from '../accounting.domain';

import { sectionPath } from '@/navigation.sections';

/** «Финучёт» — раздел аккаунта (`/ym/accounting`): учёт по всему кабинету и всем площадкам. */
export const accountingRoutes: RouteRecordRaw[] = [
  {
    path: `${sectionPath('ym', 'accounting')}/:tab?`,
    name: ACCOUNTING_ROUTE_NAME,
    component: () => import('@/modules/accounting/pages/AccountingPage.vue'),
    meta: { title: 'Финучёт' },
  },
];
