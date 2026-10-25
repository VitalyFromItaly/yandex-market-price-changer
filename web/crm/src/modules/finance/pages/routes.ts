import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Финансы» — раздел площадки: `/<площадка>/finance`, имя `<площадка>-finance` — ключ пункта меню. */
export function financeRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'finance',
      () => import('@/modules/finance/pages/FinancePage.vue'),
      'Финансы',
      '/:tab?',
    ),
  ];
}
