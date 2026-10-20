import type { StocksResponse } from '../dashboard.domain';
import type { ProfitSku } from '@/modules/profit/profit.domain';

import { describe, expect, it } from 'vitest';

import { mapLowStock, mapTopSkus } from './mapProducts.dashboard';

function sku(overrides: Partial<ProfitSku> = {}): ProfitSku {
  return {
    sku: 'A-1',
    name: 'Восток',
    count: 2,
    revenue: 10000,
    net: 2000,
    margin: 0.2,
    returns: 0,
    ...overrides,
  };
}

function levels(stocks: Record<string, number> | null): StocksResponse {
  return { fby: false, takenAt: null, threshold: 3, stocks, problem: stocks ? null : 'нет' };
}

describe('mapTopSkus', () => {
  it('порядок бэкенда, десять строк, тон маржи по знаку чистой', () => {
    const rows = Array.from({ length: 12 }, (_, i) => sku({ sku: `S-${i}`, revenue: 100 - i }));
    rows[1] = sku({ sku: 'S-1', net: -500, margin: -0.05 });
    const top = mapTopSkus(rows, levels({ 'S-0': 7 }));

    expect(top).toHaveLength(10);
    expect(top[0]).toMatchObject({
      sku: 'S-0',
      stock: '7',
      stockTone: 'warn',
      sold: '2',
      margin: '20%',
      tone: 'ok',
    });
    expect(top[1]).toMatchObject({
      margin: '-5%',
      tone: 'danger',
      stock: '0',
      stockTone: 'danger',
    });
  });

  it('остатков нет — «—», а не ноль; товар только с возвратами в топ не идёт', () => {
    const top = mapTopSkus(
      [sku(), sku({ sku: 'R', count: 0, revenue: 0, margin: null, returns: 2 })],
      null,
    );
    expect(top).toHaveLength(1);
    expect(top[0]?.stock).toBeNull();
  });

  it('остаток цветом: ≤ порога красный, ≤ 10 жёлтый, выше зелёный; нет остатков — нейтрально', () => {
    const rows = ['A', 'B', 'C', 'D'].map((code) => sku({ sku: code }));
    const tones = mapTopSkus(rows, levels({ A: 3, B: 4, C: 10, D: 11 })).map((r) => r.stockTone);
    expect(tones).toEqual(['danger', 'warn', 'warn', 'ok']);
    expect(mapTopSkus(rows, null)[0]?.stockTone).toBe('neutral');
  });

  it('возвраты — штуки и доля от проданных', () => {
    const [withReturns, without] = mapTopSkus(
      [sku({ count: 432, returns: 2 }), sku({ sku: 'B', returns: 0 })],
      null,
    );
    expect(withReturns?.returns).toBe('2 (0.5%)');
    expect(without?.returns).toBe('0');
  });
});

describe('mapLowStock', () => {
  const sold = [
    sku({ sku: 'A', revenue: 500 }),
    sku({ sku: 'B', revenue: 900 }),
    sku({ sku: 'C', revenue: 800 }),
    sku({ sku: 'D', revenue: 700 }),
    sku({ sku: 'R', count: 0, revenue: 0, margin: null, returns: 1 }),
  ];

  it('только проданные с остатком ≤ порога; пустые первыми, затем по продажам', () => {
    const rows = mapLowStock(sold, levels({ A: 3, B: 2, C: 0, D: 4, R: 0 }));
    expect(rows.map((row) => row.sku)).toEqual(['C', 'B', 'A']);
    expect(rows[0]).toMatchObject({ stock: '0', out: true });
    expect(rows[1]?.out).toBe(false);
  });

  it('нет записи остатка — ноль; не больше пяти; без остатков — пусто', () => {
    const many = Array.from({ length: 7 }, (_, i) => sku({ sku: `S-${i}` }));
    expect(mapLowStock(many, levels({}))).toHaveLength(5);
    expect(mapLowStock(many, levels(null))).toEqual([]);
  });
});
