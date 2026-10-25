import type { MarketplaceKey } from '@/navigation.sections';
import type { RouteRecordRaw } from 'vue-router';

import { sectionRoute } from '@/router/sectionRoute';

/** «Рейтинги и классификации» — раздел площадки: `/<площадка>/sku-ratings`, имя `<площадка>-sku-ratings` — ключ пункта меню. */
export function skuRatingsRoutes(mp: MarketplaceKey): RouteRecordRaw[] {
  return [
    sectionRoute(
      mp,
      'sku-ratings',
      () => import('@/modules/sku-ratings/pages/SkuRatingsPage.vue'),
      'Рейтинги товаров',
    ),
  ];
}
