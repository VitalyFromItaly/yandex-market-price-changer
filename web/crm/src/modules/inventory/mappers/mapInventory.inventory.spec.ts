import type { InventoryResponse } from '../inventory.domain';

import { describe, expect, it } from 'vitest';

import { summaryCards, tableColumns } from './mapInventory.inventory';

const data = (patch: Partial<InventoryResponse> = {}): InventoryResponse => ({
  takenAt: '2026-10-18T09:00:00.000Z',
  basisDays: 28,
  lowDays: 14,
  columns: [
    {
      marketplace: 'ym',
      label: 'Яндекс Маркет',
      state: 'ok',
      places: { seller: 'FBS', marketplace: 'FBY' },
      takenAt: null,
      hasReserve: false,
    },
    {
      marketplace: 'ozon',
      label: 'Ozon',
      state: 'not-connected',
      places: { seller: 'FBS', marketplace: 'FBO' },
      takenAt: null,
      hasReserve: false,
    },
  ],
  rows: [],
  unmatched: [],
  totals: {
    ownKopecks: 1_200_000,
    marketplaceKopecks: 400_000,
    withoutCost: { products: 2, units: 7 },
  },
  ownStockAt: null,
  problems: [],
  notes: [],
  ...patch,
});

describe('сводка склада', () => {
  it('свой склад и склады площадок — раздельно; без себестоимости — штуками', () => {
    const [own, marketplaces, withoutCost] = summaryCards(data());
    expect([own?.key, marketplaces?.key, withoutCost?.key]).toEqual([
      'own',
      'marketplaces',
      'without-cost',
    ]);
    expect(marketplaces?.caption).toContain('FBY');
    expect(marketplaces?.caption).not.toContain('FBO');
    expect(withoutCost?.value).toBe('7 шт.');
    expect(withoutCost?.caption).toContain('2 товара');
    expect(own?.caption).toContain('не загружали');
  });

  it('в таблице — только площадки с числами', () => {
    expect(tableColumns(data()).map((column) => column.marketplace)).toEqual(['ym']);
  });
});
