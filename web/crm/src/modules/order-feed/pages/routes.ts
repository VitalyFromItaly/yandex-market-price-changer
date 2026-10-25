import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Лента заказов» — раздел площадки: `/<площадка>/order-feed`, имя `<площадка>-order-feed` — ключ пункта меню. */
export function orderFeedRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'order-feed',
      () => import('@/modules/order-feed/pages/OrderFeedPage.vue'),
      'Лента заказов',
    ),
  ];
}
