import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Прогнозы» — раздел площадки: `/<площадка>/forecast`, имя `<площадка>-forecast` — ключ пункта меню. */
export function forecastRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'forecast',
      () => import('@/modules/forecast/pages/ForecastPage.vue'),
      'Прогнозы',
    ),
  ];
}
