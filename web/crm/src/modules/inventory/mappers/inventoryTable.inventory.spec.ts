import type { InventoryRow } from '../inventory.domain';

import { describe, expect, it } from 'vitest';

import { amountLabel, filterRows, isLow, nextSort, sortRows } from './inventoryTable.inventory';

const row = (patch: Partial<InventoryRow>): InventoryRow => ({
  productId: 'p',
  internalSku: 'A1',
  name: 'Casio A1',
  ownStock: 5,
  ownStockAt: null,
  costKopecks: 100_000,
  byMarketplace: {},
  atMarketplaces: 0,
  inTransit: null,
  returning: null,
  unitsPerDay: 1,
  daysLeft: 5,
  valueKopecks: 500_000,
  ...patch,
});

describe('таблица склада', () => {
  it('«заканчивается» — по порогу из ответа; без продаж — нет', () => {
    expect(isLow(row({ daysLeft: 13 }), 14)).toBe(true);
    expect(isLow(row({ daysLeft: 14 }), 14)).toBe(false);
    expect(isLow(row({ daysLeft: null }), 14)).toBe(false);
  });

  it('поиск по артикулу и названию, фильтры', () => {
    const rows = [
      row({ productId: '1', internalSku: 'F-91W', name: 'Casio', daysLeft: 3 }),
      row({
        productId: '2',
        internalSku: 'X',
        name: 'Orient Bambino',
        daysLeft: 40,
        costKopecks: null,
      }),
    ];
    expect(filterRows(rows, 'bambino', 'all', 14).map((r) => r.productId)).toEqual(['2']);
    expect(filterRows(rows, 'f-91', 'all', 14).map((r) => r.productId)).toEqual(['1']);
    expect(filterRows(rows, '', 'low', 14).map((r) => r.productId)).toEqual(['1']);
    expect(filterRows(rows, '', 'no-cost', 14).map((r) => r.productId)).toEqual(['2']);
  });

  it('«нет данных» — в конце в любом направлении', () => {
    const rows = [
      row({ productId: 'a', daysLeft: null }),
      row({ productId: 'b', daysLeft: 9 }),
      row({ productId: 'c', daysLeft: 2 }),
    ];
    expect(sortRows(rows, 'daysLeft', 'asc').map((r) => r.productId)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, 'daysLeft', 'desc').map((r) => r.productId)).toEqual(['b', 'c', 'a']);
  });

  it('направление: дни — по возрастанию, количества — по убыванию, повтор меняет', () => {
    expect(nextSort({ key: 'daysLeft', dir: 'asc' }, 'ownStock')).toEqual({
      key: 'ownStock',
      dir: 'desc',
    });
    expect(nextSort({ key: 'ownStock', dir: 'desc' }, 'ownStock')).toEqual({
      key: 'ownStock',
      dir: 'asc',
    });
  });

  it('резерв печатается только когда площадка его сообщает', () => {
    expect(amountLabel({ available: 12, reserved: 3 })).toBe('12 · резерв 3');
    expect(amountLabel({ available: 12, reserved: null })).toBe('12');
    expect(amountLabel(null)).toBe('—');
  });
});
