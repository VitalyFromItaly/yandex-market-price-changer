import type { MarketplaceKey, MarketplaceSection } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { aiAnalystRoutes } from '@/modules/ai-analyst/pages/routes';
import { authPublicRoutes } from '@/modules/auth/pages/routes';
import { dashboardRoutes } from '@/modules/dashboard/pages/routes';
import { expensesRoutes } from '@/modules/expenses/pages/routes';
import { fbyRoutes } from '@/modules/fby/pages/routes';
import { feedbackRoutes } from '@/modules/feedback/pages/routes';
import { financeRoutes } from '@/modules/finance/pages/routes';
import { forecastRoutes } from '@/modules/forecast/pages/routes';
import { helpRoutes } from '@/modules/help/pages/routes';
import { inventoryRoutes } from '@/modules/inventory/pages/routes';
import { marketReportsRoutes } from '@/modules/market-reports/pages/routes';
import { marketplaceCompareRoutes } from '@/modules/marketplace-compare/pages/routes';
import { connectionsRoutes, marketplacesRoutes } from '@/modules/marketplaces/pages/routes';
import { marketplacesDashboardRoutes } from '@/modules/marketplaces-dashboard/pages/routes';
import { notificationsRoutes } from '@/modules/notifications/pages/routes';
import { offerCardsRoutes } from '@/modules/offer-cards/pages/routes';
import { orderFeedRoutes } from '@/modules/order-feed/pages/routes';
import { ordersRoutes } from '@/modules/orders/pages/routes';
import { overviewRoutes } from '@/modules/overview/pages/routes';
import { paymentsRoutes } from '@/modules/payments/pages/routes';
import { priceCalculatorRoutes } from '@/modules/price-calculator/pages/routes';
import { priceListRoutes } from '@/modules/price-list/pages/routes';
import { productsRoutes } from '@/modules/products/pages/routes';
import { profileRoutes } from '@/modules/profile/pages/routes';
import { profitRoutes } from '@/modules/profit/pages/routes';
import { purchasesRoutes } from '@/modules/purchases/pages/routes';
import { quarantineRoutes } from '@/modules/quarantine/pages/routes';
import { recommendationsRoutes } from '@/modules/recommendations/pages/routes';
import { returnsAnalyticsRoutes } from '@/modules/returns-analytics/pages/routes';
import { salesAnalyticsRoutes } from '@/modules/sales-analytics/pages/routes';
import { settingsRoutes } from '@/modules/settings/pages/routes';
import { skuRatingsRoutes } from '@/modules/sku-ratings/pages/routes';
import { stockPushRoutes } from '@/modules/stock-push/pages/routes';
import { storeRoutes, storesRoutes } from '@/modules/stores/pages/routes';
import { taxesRoutes } from '@/modules/taxes/pages/routes';
import { unitEconomicsRoutes } from '@/modules/unit-economics/pages/routes';
import { warehousesRoutes } from '@/modules/warehouses/pages/routes';
import { ACCOUNT_LEVEL_NAV, ALL_MARKETPLACES } from '@/navigation';
import { READY_SECTIONS, sectionPath } from '@/navigation.sections';

/*
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

/*
 * Разделы вида «площадка» — фабрикой от площадки: `/ym/finance`, `/ozon/finance`.
 * Раздел без фабрики не компилируется; маршрут площадки появляется, только когда
 * её раздел готов (`READY_SECTIONS`), — до того её адреса ведут на «скоро».
 */
const MARKETPLACE_ROUTES: Record<MarketplaceSection, (mp: MarketplaceKey) => RouteRecordRaw[]> = {
  overview: overviewRoutes,
  finance: financeRoutes,
  'unit-economics': unitEconomicsRoutes,
  'sales-analytics': salesAnalyticsRoutes,
  'sku-ratings': skuRatingsRoutes,
  inventory: inventoryRoutes,
  'order-feed': orderFeedRoutes,
  'returns-analytics': returnsAnalyticsRoutes,
  forecast: forecastRoutes,
};

const marketplaceRoutes: RouteRecordRaw[] = ALL_MARKETPLACES.flatMap(({ key }) =>
  READY_SECTIONS[key].flatMap((section) => MARKETPLACE_ROUTES[section](key)),
);

const HOME = sectionPath('ym', 'stores');

const accountRoutes: RouteRecordRaw[] = [
  ...marketplaceRoutes,
  ...marketplacesDashboardRoutes,
  ...marketplaceCompareRoutes,
  ...stockPushRoutes,
  ...productsRoutes,
  ...priceCalculatorRoutes,
  ...aiAnalystRoutes,
  ...notificationsRoutes,
  ...storesRoutes,
  ...settingsRoutes,
  ...expensesRoutes,
  ...taxesRoutes,
  ...purchasesRoutes,
  ...connectionsRoutes,
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

export const routes: RouteRecordRaw[] = [
  ...authPublicRoutes,
  {
    path: '/',
    component: () => import('@/components/layout/AppShell.vue'),
    children: [
      { path: '', redirect: HOME },
      ...accountRoutes,
      ...storeRoutes(inStoreRoutes),
      ...placeholderRoutes,
      // `/ozon`, `/wb` — живые адреса площадок «скоро», а не catch-all ниже.
      ...marketplacesRoutes,
    ],
  },
  // Старые адреса разделов (#/ym/orders и т.п.) не знают магазина — в список.
  { path: '/:pathMatch(.*)*', redirect: HOME },
];
