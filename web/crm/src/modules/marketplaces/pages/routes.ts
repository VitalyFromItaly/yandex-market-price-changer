import type { RouteRecordRaw } from 'vue-router';

import { CONNECTIONS_ROUTE_NAME } from '../marketplaces.domain';

import { UPCOMING_MARKETPLACES } from '@/navigation';

/**
 * «Подключения» (TASK-161) — раздел аккаунта, имя совпадает с пунктом меню.
 * Прежние адреса подключения Ozon (`/ozon`, `/ozon/connection`, TASK-128) и
 * корень `/wb` ведут сюда же: ключ площадки теперь живёт только здесь.
 */
export const connectionsRoutes: RouteRecordRaw[] = [
  {
    path: '/connections',
    name: CONNECTIONS_ROUTE_NAME,
    component: () => import('@/modules/marketplaces/pages/ConnectionsPage.vue'),
    meta: { title: 'Подключения' },
  },
  { path: '/ozon', redirect: { name: CONNECTIONS_ROUTE_NAME } },
  { path: '/ozon/connection', redirect: { name: CONNECTIONS_ROUTE_NAME } },
  { path: '/wb', redirect: { name: CONNECTIONS_ROUTE_NAME } },
];

/** Имя маршрута страницы площадки «скоро». */
export const MARKETPLACE_UPCOMING_ROUTE_NAME = 'marketplace-upcoming';

/**
 * Всё прочее под `/ozon` и `/wb` — страница площадки «скоро», а не разделы ЯМ
 * и не catch-all в список магазинов: когда у площадки появятся разделы с
 * данными (Ozon — TASK-130…131, WB — TASK-134…136), она уйдёт из
 * `UPCOMING_MARKETPLACES`. Статические пути выше роутер ставит выше этого шаблона.
 */
export const marketplacesRoutes: RouteRecordRaw[] =
  UPCOMING_MARKETPLACES.length === 0
    ? []
    : [
        {
          path: `/:mp(${UPCOMING_MARKETPLACES.map((m) => m.key).join('|')})/:rest(.*)*`,
          name: MARKETPLACE_UPCOMING_ROUTE_NAME,
          component: () => import('@/modules/marketplaces/pages/MarketplaceUpcomingPage.vue'),
          meta: { title: 'Площадка' },
        },
      ];
