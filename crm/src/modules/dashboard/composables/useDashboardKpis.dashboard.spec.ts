import { describe, expect, it } from 'vitest';

import { openKpis, openOrderRows, openSources, quickLinks } from './useDashboardKpis.dashboard';

const ALL = {
  report_in_transit: true,
  report_returning: true,
  report_profit: true,
  report_redeemed: true,
};

describe('видимость на главной', () => {
  it('источник — по фиче; FBY — по разделу магазина (фича плюс модель решает сервер)', () => {
    expect(openSources(ALL, ['ym-fby']).map((s) => s.key)).toEqual([
      'profit',
      'in_transit',
      'returning',
      'redeemed',
      'fby',
      // Остатки по товарам — под той же фичей, что «Топ товаров».
      'stocks',
    ]);
    expect(
      openSources({ ...ALL, report_profit: false, report_redeemed: false }, []).map((s) => s.key),
    ).toEqual(['in_transit', 'returning']);
    // Фича fby сама по себе ничего не открывает: у не-FBY магазина раздела нет.
    expect(openSources({ fby: true }, ['ym-orders']).map((s) => s.key)).toEqual([]);
    expect(openSources(undefined, null)).toEqual([]);
  });

  it('карточки — пять денежных из одной «Прибыли», затем срезы', () => {
    expect(openKpis(['profit', 'fby']).map((k) => k.key)).toEqual([
      'sales',
      'commission',
      'tax',
      'purchase',
      'net',
      'stock',
    ]);
    expect(openKpis(['returning']).map((k) => k.key)).toEqual(['returning']);
  });

  it('блок «Заказы» — строки открытых источников, в порядке образца', () => {
    expect(
      openOrderRows(['profit', 'in_transit', 'redeemed', 'returning']).map((r) => r.key),
    ).toEqual(['placed', 'in_transit', 'redeemed', 'returning', 'cancelled']);
    // Без «Прибыли» нет ни оформленных, ни отмен; без report_redeemed — выкупленных.
    expect(openOrderRows(['in_transit', 'returning']).map((r) => r.key)).toEqual([
      'in_transit',
      'returning',
    ]);
    expect(openOrderRows(['fby'])).toEqual([]);
  });

  it('ссылки — открытые разделы без самой главной', () => {
    expect(quickLinks(['ym-dashboard', 'ym-orders', 'profile']).map((i) => i.name)).toEqual([
      'ym-orders',
    ]);
    expect(quickLinks(null)).toEqual([]);
  });
});
