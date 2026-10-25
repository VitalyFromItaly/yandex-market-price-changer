import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { routes } from './routes';

import { MARKETPLACE_NAV } from '@/navigation';

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes });
}

describe('маршруты CRM', () => {
  it('каждый раздел ЯМ открывается по прежнему адресу под прежним именем', () => {
    const router = makeRouter();
    for (const item of MARKETPLACE_NAV) {
      expect(router.resolve({ name: item.name }).path).toBe(item.path);
      expect(router.resolve(item.path).name).toBe(item.name);
    }
  });

  it('вкладка финансов и старый адрес ДДС', () => {
    const router = makeRouter();
    expect(router.resolve('/ym/finance/cashflow').name).toBe('ym-finance');
    const legacy = router.resolve('/ym/purchases/cashflow');
    expect(legacy.matched.at(-1)?.redirect).toBe('/ym/finance/cashflow');
  });

  it('Ozon и WB: «Финансы» — свой раздел (TASK-180), прочие адреса — «скоро», а не ЯМ', () => {
    const router = makeRouter();
    expect(router.resolve('/ozon/finance').name).toBe('ozon-finance');
    expect(router.resolve('/wb/finance/audit').name).toBe('wb-finance');
    expect(router.resolve('/wb/stores').name).toBe('marketplace-upcoming');
  });

  it('Ozon и WB: главная и прогноз (TASK-183) — свои маршруты', () => {
    const router = makeRouter();
    expect(router.resolve('/ozon/overview').name).toBe('ozon-overview');
    expect(router.resolve('/wb/forecast').name).toBe('wb-forecast');
    expect(router.resolve('/ym/overview').name).toBe('ym-overview');
  });

  it('Ozon и WB: склад, лента заказов и возвраты (TASK-182) — свои маршруты', () => {
    const router = makeRouter();
    expect(router.resolve('/ozon/order-feed').name).toBe('ozon-order-feed');
    expect(router.resolve('/ozon/returns-analytics').name).toBe('ozon-returns-analytics');
    expect(router.resolve('/ozon/inventory').name).toBe('ozon-inventory');
    expect(router.resolve('/wb/order-feed').name).toBe('wb-order-feed');
    expect(router.resolve('/ym/inventory').name).toBe('ym-inventory');
  });

  it('Ozon и WB: аналитика по журналу площадки (TASK-181) — свои маршруты', () => {
    const router = makeRouter();
    expect(router.resolve('/ozon/unit-economics').name).toBe('ozon-unit-economics');
    expect(router.resolve('/ozon/sales-analytics').name).toBe('ozon-sales-analytics');
    expect(router.resolve('/wb/sku-ratings').name).toBe('wb-sku-ratings');
    expect(router.resolve('/ym/unit-economics').name).toBe('ym-unit-economics');
  });

  it('корень и неизвестный адрес — в список магазинов ЯМ', async () => {
    const router = makeRouter();
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/ym/stores');
    await router.push('/nope/at/all');
    expect(router.currentRoute.value.path).toBe('/ym/stores');
  });
});
