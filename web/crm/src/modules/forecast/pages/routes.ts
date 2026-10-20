import type { RouteRecordRaw } from 'vue-router';

import { FORECAST_ROUTE_NAME } from '../forecast.domain';

/** «Прогнозы» — раздел аккаунта; имя — ключ пункта меню `ym-forecast`. */
export const forecastRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/forecast',
    name: FORECAST_ROUTE_NAME,
    component: () => import('@/modules/forecast/pages/ForecastPage.vue'),
    meta: { title: 'Прогнозы' },
  },
];
