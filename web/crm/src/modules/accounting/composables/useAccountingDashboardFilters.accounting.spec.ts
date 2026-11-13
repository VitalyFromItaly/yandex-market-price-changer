import { describe, expect, it } from 'vitest';

import { useAccountingDashboardFilters } from './useAccountingDashboardFilters.accounting';

const STORES = [
  { key: 'a', label: 'Магазин А' },
  { key: 'b', label: 'Магазин Б' },
];

describe('useAccountingDashboardFilters', () => {
  it('по умолчанию — первый магазин, базис продажи, этот месяц диапазоном, без фильтра', () => {
    const f = useAccountingDashboardFilters(() => STORES, '2026-11-11');
    expect(f.dashboardRequest.value).toEqual({
      store: 'a',
      basis: 'sale',
      range: { from: '2026-11-01', to: '2026-11-11' },
      filter: { marketplace: null, brand: null, offerId: null, orderId: null },
    });
    expect(f.analyticsRequest.value).toEqual({
      store: 'a',
      range: { from: '2026-11-01', to: '2026-11-11' },
    });
    expect(f.filtered.value).toBe(false);
  });

  it('артикул и заказ — только по «Применить», обрезаны; сброс — обратно', () => {
    const f = useAccountingDashboardFilters(() => STORES, '2026-11-11');
    f.offerDraft.value = '  A-1 ';
    expect(f.dashboardRequest.value?.filter.offerId).toBeNull();
    f.applyRefs();
    f.marketplace.value = 'ozon';
    expect(f.dashboardRequest.value?.filter).toEqual({
      marketplace: 'ozon',
      brand: null,
      offerId: 'A-1',
      orderId: null,
    });
    expect(f.filtered.value).toBe(true);
    // Аналитика — без фильтра панели.
    expect(f.analyticsRequest.value).not.toHaveProperty('filter');
    f.resetFilter();
    expect(f.filtered.value).toBe(false);
  });

  it('пресеты пикера — диапазоном; непригодный свой период — без запроса', () => {
    const f = useAccountingDashboardFilters(() => STORES, '2026-11-11');
    f.choosePreset('yesterday');
    expect(f.dashboardRequest.value?.range).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    f.chooseCustom({ from: '2026-11-05', to: '2026-11-01' });
    expect(f.dashboardRequest.value).toBeNull();
    expect(f.analyticsRequest.value).toBeNull();
  });

  it('нет магазинов — запросов нет', () => {
    const f = useAccountingDashboardFilters(() => [], '2026-11-11');
    expect(f.dashboardRequest.value).toBeNull();
  });
});
