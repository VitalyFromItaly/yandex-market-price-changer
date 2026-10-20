import type { IPnlSku } from '../../src/modules/finance/pnl-sku';

import { describe, expect, it } from 'vitest';

import { brandEconomicsOf } from '../../src/modules/finance/pnl-brand';
import { SKU_COLUMNS } from '../../src/modules/finance/pnl-sku';

/** Экономика по брендам — свёртка строк разреза товаров, без своей формулы. */

function sku(name: string, revenue: number, net: number, over: Partial<IPnlSku> = {}): IPnlSku {
  const columns = Object.fromEntries(SKU_COLUMNS.map((c) => [c, 0])) as IPnlSku['columns'];
  columns.revenue = revenue;
  columns.commission = -Math.round(revenue / 10);
  return {
    sku: name,
    scheme: 'FBS',
    columns,
    cogsKopecks: 100,
    taxKopecks: 10,
    netKopecks: net,
    units: 1,
    orders: 1,
    costKnown: true,
    schemes: [],
    ...over,
  };
}

const products = new Map([
  ['A1', { name: 'Casio F-91W' }],
  ['A2', { name: 'Часы Casio A158' }],
  ['S1', { name: 'Seiko 5', category: 'Наручные часы' }],
]);

describe('brandEconomicsOf', () => {
  const rows = [
    sku('S1', 3000, 500),
    sku('A1', 1000, 200),
    sku('A2', 2000, 700, { costKnown: false, units: 2 }),
    sku('X9', 500, 50),
  ];
  const brands = brandEconomicsOf(rows, products);

  it('бренды в порядке реестра, «Остальные» последними, товар не из базы — в «Остальных»', () => {
    expect(brands.map((b) => b.key)).toEqual(['casio', 'seiko', null]);
    expect(brands[2]).toMatchObject({ title: 'Остальные', skus: 1 });
  });

  it('Σ брендов = Σ товаров по каждой колонке, закупу, налогу и чистой', () => {
    for (const column of SKU_COLUMNS) {
      expect(brands.reduce((s, b) => s + b.columns[column], 0)).toBe(
        rows.reduce((s, r) => s + r.columns[column], 0),
      );
    }
    expect(brands.reduce((s, b) => s + b.netKopecks, 0)).toBe(1450);
    expect(brands.reduce((s, b) => s + b.cogsKopecks, 0)).toBe(400);
    expect(brands.reduce((s, b) => s + b.units, 0)).toBe(5);
  });

  it('costKnown бренда ложен, если хоть у одного товара нет закупа; товары — по чистой', () => {
    const casio = brands[0];
    expect(casio).toMatchObject({ skus: 2, units: 3, orders: 2, costKnown: false });
    expect(casio.items.map((i) => i.sku)).toEqual(['A2', 'A1']);
    expect(brands[1].costKnown).toBe(true);
  });
});
