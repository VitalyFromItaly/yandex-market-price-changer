import type { RouteRecordRaw } from 'vue-router';

import { OFFER_CARDS_ROUTE_NAME } from '../offer-cards.domain';

/** Раздел магазина (`/ym/stores/:store/offer-cards`); имя — ключ пункта меню. */
export const offerCardsRoutes: RouteRecordRaw[] = [
  {
    path: 'offer-cards',
    name: OFFER_CARDS_ROUTE_NAME,
    component: () => import('@/modules/offer-cards/pages/OfferCardsPage.vue'),
    meta: { title: 'Карточки' },
  },
];
