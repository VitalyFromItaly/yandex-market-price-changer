import type { TopSkuRow, TopSkusResponse } from '../top-skus.domain';

import { describe, expect, it } from 'vitest';

import { isOwnTopSkus, placeViews, topSkusParams, visibleSkus } from './mapTopSkus.top-skus';

const row = (sku: string, count: number, revenue: number, margin: number | null): TopSkuRow => ({
  sku,
  name: `Часы ${sku}`,
  count,
  revenue,
  net: revenue / 2,
  margin,
  returns: 0,
});

describe('маппер «Топа товаров»', () => {
  const request = { store: 's', range: { from: '2026-10-01', to: '2026-10-31' } };

  it('params и сверка эха — одним диапазоном', () => {
    expect(topSkusParams(request)).toEqual({
      period: { key: 'range', from: '01-10-2026', to: '31-10-2026' },
    });
    const echo = { period: { key: 'range', day: null, from: '01-10-2026', to: '31-10-2026' } };
    expect(isOwnTopSkus(echo as TopSkusResponse, request)).toBe(true);
    expect(
      isOwnTopSkus({ period: { ...echo.period, to: '30-10-2026' } } as TopSkusResponse, request),
    ).toBe(false);
  });

  it('только проданные, поиск по артикулу и названию, сортировка', () => {
    const rows = [row('A', 1, 300, 0.1), row('B', 5, 200, null), row('C', 0, 0, null)];
    expect(visibleSkus(rows, '', 'revenue').map((r) => r.sku)).toEqual(['A', 'B']);
    expect(visibleSkus(rows, '', 'count').map((r) => r.sku)).toEqual(['B', 'A']);
    // Неизвестная маржа — в конце, а не нулём.
    expect(visibleSkus(rows, '', 'margin').map((r) => r.sku)).toEqual(['A', 'B']);
    expect(visibleSkus(rows, 'часы b', 'revenue').map((r) => r.sku)).toEqual(['B']);
  });

  it('доля места; итог ноль — null', () => {
    expect(placeViews([{ name: 'X', count: 1, revenue: 25, net: 5 }], 100)[0]?.share).toBe(0.25);
    expect(placeViews([{ name: 'X', count: 1, revenue: 25, net: 5 }], 0)[0]?.share).toBeNull();
    expect(placeViews(null, 100)).toEqual([]);
  });
});
