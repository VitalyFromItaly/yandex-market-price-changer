import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Аналитика возвратов» — раздел площадки: `/<площадка>/returns-analytics`, имя `<площадка>-returns-analytics` — ключ пункта меню. */
export function returnsAnalyticsRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'returns-analytics',
      () => import('@/modules/returns-analytics/pages/ReturnsAnalyticsPage.vue'),
      'Аналитика возвратов',
    ),
  ];
}
