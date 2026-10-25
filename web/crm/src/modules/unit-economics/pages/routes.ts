import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Unit-экономика» — раздел площадки: `/<площадка>/unit-economics`, имя `<площадка>-unit-economics` — ключ пункта меню. */
export function unitEconomicsRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'unit-economics',
      () => import('@/modules/unit-economics/pages/UnitEconomicsPage.vue'),
      'Unit-экономика',
    ),
  ];
}
