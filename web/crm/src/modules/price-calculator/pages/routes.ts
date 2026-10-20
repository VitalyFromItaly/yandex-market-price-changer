import type { RouteRecordRaw } from 'vue-router';

import { PRICE_CALCULATOR_ROUTE_NAME } from '../price-calculator.domain';

/** «Калькулятор цен» — раздел аккаунта; `?sku=` открывает его с товаром (ссылка из unit-экономики). */
export const priceCalculatorRoutes: RouteRecordRaw[] = [
  {
    path: '/ym/price-calculator',
    name: PRICE_CALCULATOR_ROUTE_NAME,
    component: () => import('@/modules/price-calculator/pages/PriceCalculatorPage.vue'),
    meta: { title: 'Калькулятор цен' },
  },
];
