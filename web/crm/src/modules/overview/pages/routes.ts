import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Обзор» — раздел площадки: `/<площадка>/overview`, имя `<площадка>-overview` — ключ пункта меню. */
export function overviewRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'overview',
      () => import('@/modules/overview/pages/OverviewPage.vue'),
      'Обзор',
    ),
  ];
}
