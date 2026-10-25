import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Аналитика продаж» — раздел площадки: `/<площадка>/sales-analytics`, имя `<площадка>-sales-analytics` — ключ пункта меню. */
export function salesAnalyticsRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'sales-analytics',
      () => import('@/modules/sales-analytics/pages/SalesAnalyticsPage.vue'),
      'Аналитика продаж',
    ),
  ];
}
