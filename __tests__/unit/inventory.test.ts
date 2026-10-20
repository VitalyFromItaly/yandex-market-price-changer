import type { IInventoryProduct } from '../../src/modules/finance/inventory';

import { describe, expect, it } from 'vitest';

import { daysLeftOf, INVENTORY_LOW_DAYS, inventoryOf } from '../../src/modules/finance/inventory';

const product = (patch: Partial<IInventoryProduct> = {}): IInventoryProduct => ({
  id: 'p1',
  internalSku: 'A1',
  name: 'Casio A1',
  skus: { ym: 'A1', ozon: 'OZ-A1' },
  ownStock: 10,
  ownStockAt: new Date('2026-10-17T10:00:00Z'),
  costRub: 1000,
  ...patch,
});

describe('единый склад — inventoryOf', () => {
  it('FBS площадок не входит ни в стоимость, ни в дни запаса: это тот же свой склад', () => {
    const inventory = inventoryOf(
      [product()],
      [
        {
          marketplace: 'ym',
          levels: { seller: { A1: { available: 10, reserved: null } } },
          inTransit: new Map([['A1', 2]]),
          returning: new Map(),
          sold: new Map([['p1', 28]]),
        },
        {
          marketplace: 'ozon',
          levels: {
            seller: { 'OZ-A1': { available: 10, reserved: 1 } },
            marketplace: { 'OZ-A1': { available: 4, reserved: 2 } },
          },
          inTransit: new Map([['OZ-A1', 1]]),
          returning: null,
          sold: new Map([['p1', 28]]),
        },
      ],
      28,
    );

    const [row] = inventory.rows;
    expect(row.atMarketplaces).toBe(4);
    // Свой склад 10 + FBO 4; FBS ЯМ и Ozon (по 10) — те же десять штук.
    expect(row.valueKopecks).toBe(14 * 100_000);
    expect(inventory.totals).toEqual({
      ownKopecks: 10 * 100_000,
      marketplaceKopecks: 4 * 100_000,
      withoutCost: { products: 0, units: 0 },
    });
    expect(row.unitsPerDay).toBe(2);
    expect(row.daysLeft).toBe(7);
    expect(row.inTransit).toBe(3);
    // Возвраты ЯМ известны (0), Ozon — нет: итог по известным, а не «нет данных».
    expect(row.returning).toBe(0);
    expect(row.byMarketplace.ozon).toMatchObject({
      seller: { available: 10, reserved: 1 },
      marketplace: { available: 4, reserved: 2 },
      returning: null,
    });
    expect(inventory.lowDays).toBe(INVENTORY_LOW_DAYS);
  });

  it('товар без себестоимости — отдельной строкой итога, не нулём', () => {
    const inventory = inventoryOf([product({ costRub: null, ownStock: 5 })], [], 28);
    expect(inventory.rows[0].valueKopecks).toBeNull();
    expect(inventory.totals).toEqual({
      ownKopecks: 0,
      marketplaceKopecks: 0,
      withoutCost: { products: 1, units: 5 },
    });
  });

  it('дни запаса: без продаж — null, без остатка — 0', () => {
    expect(daysLeftOf(10, 0)).toBeNull();
    expect(daysLeftOf(0, 1.5)).toBe(0);
    const inventory = inventoryOf(
      [product({ ownStock: 0 })],
      [
        {
          marketplace: 'ym',
          levels: {},
          inTransit: null,
          returning: null,
          sold: new Map([['p1', 14]]),
        },
      ],
      28,
    );
    expect(inventory.rows[0].daysLeft).toBe(0);
    expect(inventory.rows[0].inTransit).toBeNull();

    const noSales = inventoryOf([product()], [], 28);
    expect(noSales.rows[0].unitsPerDay).toBeNull();
    expect(noSales.rows[0].daysLeft).toBeNull();
  });

  it('карточка площадки без товара — в unmatched с числами, не теряется', () => {
    const inventory = inventoryOf(
      [product()],
      [
        {
          marketplace: 'wb',
          levels: { marketplace: { 'WB-X': { available: 3, reserved: null } } },
          inTransit: new Map([['WB-Y', 1]]),
          returning: new Map(),
          sold: null,
        },
      ],
      28,
    );
    expect(inventory.unmatched).toEqual([
      {
        marketplace: 'wb',
        sku: 'WB-X',
        seller: null,
        marketplaceStock: 3,
        inTransit: 0,
        returning: 0,
      },
      {
        marketplace: 'wb',
        sku: 'WB-Y',
        seller: null,
        marketplaceStock: 0,
        inTransit: 1,
        returning: 0,
      },
    ]);
  });

  it('товар без единого числа не печатается; заканчивающиеся — первыми', () => {
    const inventory = inventoryOf(
      [
        product({ id: 'idle', internalSku: 'Z', ownStock: 0, skus: {} }),
        product({ id: 'slow', internalSku: 'B', ownStock: 100 }),
        product({ id: 'fast', internalSku: 'C', ownStock: 2, skus: { ym: 'C' } }),
      ],
      [
        {
          marketplace: 'ym',
          levels: {},
          inTransit: null,
          returning: null,
          sold: new Map([
            ['slow', 28],
            ['fast', 28],
          ]),
        },
      ],
      28,
    );
    expect(inventory.rows.map((row) => row.productId)).toEqual(['fast', 'slow']);
  });
});
