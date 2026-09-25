import type { RouteRecordRaw } from 'vue-router';

import { createRouter, createWebHashHistory } from 'vue-router';

import { useAuthGuard } from '@/modules/auth/composables/useAuthGuard.auth';
import { authPublicRoutes } from '@/modules/auth/pages/routes';
import { dashboardRoutes } from '@/modules/dashboard/pages/routes';
import { fbyRoutes } from '@/modules/fby/pages/routes';
import { feedbackRoutes } from '@/modules/feedback/pages/routes';
import { helpRoutes } from '@/modules/help/pages/routes';
import { marketReportsRoutes } from '@/modules/market-reports/pages/routes';
import { offerCardsRoutes } from '@/modules/offer-cards/pages/routes';
import { ordersRoutes } from '@/modules/orders/pages/routes';
import { paymentsRoutes } from '@/modules/payments/pages/routes';
import { priceListRoutes } from '@/modules/price-list/pages/routes';
import { profileRoutes } from '@/modules/profile/pages/routes';
import { profitRoutes } from '@/modules/profit/pages/routes';
import { quarantineRoutes } from '@/modules/quarantine/pages/routes';
import { recommendationsRoutes } from '@/modules/recommendations/pages/routes';
import { settingsRoutes } from '@/modules/settings/pages/routes';
import { storeRoutes, storesRoutes } from '@/modules/stores/pages/routes';
import { warehousesRoutes } from '@/modules/warehouses/pages/routes';
import { ACCOUNT_LEVEL_NAV } from '@/navigation';

/*
 * Hash history — довод админки: F5 на #/ym/stores/… не уходит на сервер, SPA-
 * fallback не нужен, а значит ему негде проглотить ошибку /api. Заодно такой
 * перезагрузке не на что получить 404, который фильтр пометил бы «scanner».
 *
 * Маршруты модулей (modules/<m>/pages/routes.ts) спредятся в children шелла и
 * вытесняют заглушку раздела с тем же именем. Разделы магазина — детьми
 * `/ym/stores/:store`: отчёты считаются по магазину из адреса.
 */
const inStoreRoutes: RouteRecordRaw[] = [
  ...dashboardRoutes,
  ...ordersRoutes,
  ...profitRoutes,
  ...priceListRoutes,
  ...quarantineRoutes,
  ...feedbackRoutes,
  ...paymentsRoutes,
  ...marketReportsRoutes,
  ...recommendationsRoutes,
  ...offerCardsRoutes,
  ...fbyRoutes,
  ...warehousesRoutes,
];

const accountRoutes: RouteRecordRaw[] = [
  ...storesRoutes,
  ...settingsRoutes,
  ...profileRoutes,
  ...helpRoutes,
];

const moduleNames = new Set(accountRoutes.map((route) => route.name));

const placeholderRoutes: RouteRecordRaw[] = ACCOUNT_LEVEL_NAV.filter(
  (item) => !moduleNames.has(item.name),
).map((item) => ({
  path: item.path,
  name: item.name,
  component: () => import('@/components/layout/SectionPlaceholder.vue'),
  meta: { title: item.label, description: item.description },
}));

const routes: RouteRecordRaw[] = [
  ...authPublicRoutes,
  {
    path: '/',
    component: () => import('@/components/layout/AppShell.vue'),
    children: [
      { path: '', redirect: '/ym/stores' },
      ...accountRoutes,
      ...storeRoutes(inStoreRoutes),
      ...placeholderRoutes,
    ],
  },
  // Старые адреса разделов (#/ym/orders и т.п.) не знают магазина — в список.
  { path: '/:pathMatch(.*)*', redirect: '/ym/stores' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// Вход и принудительная смена пароля (решение crm_initial_password).
router.beforeEach(useAuthGuard());

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : null;
  document.title = title === null ? 'CRM продавца' : `${title} — CRM продавца`;
});
