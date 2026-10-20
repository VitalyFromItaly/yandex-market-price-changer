import type { IExpenseAllocation } from '../../src/modules/finance/expense-allocation';
import type { IPnlLine } from '../../src/modules/finance/pnl';
import type { ITaxSettings } from '../../src/modules/finance/tax.domain';

import { describe, expect, it } from 'vitest';

import { monthPeriod } from '../../src/modules/finance/finance-period';
import { pnlOf } from '../../src/modules/finance/pnl';
import {
  OTHER_BRAND_TITLE,
  periodDaysOf,
  salesAnalyticsOf,
  salesFigures,
} from '../../src/modules/finance/sales-analytics';

/** «Аналитика продаж» (TASK-140): свёртка разрезов из готового P&L. */

const SEPT = monthPeriod(2026, 9);
const NO_EXPENSES: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };
const USN_6: ITaxSettings = { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' };

let seq = 0;
const sale = (over: Partial<IPnlLine>): IPnlLine => {
  seq += 1;
  return {
    id: `op-${seq}`,
    article: 'sales',
    amountKopecks: 100_000,
    sku: 'W-1',
    count: 1,
    goods: 'sold',
    accruedDay: '2026-09-10',
    paidDay: null,
    ...over,
  };
};

const pnl = (lines: IPnlLine[]) =>
  pnlOf({ lines, period: SEPT, costOf: () => 50_000, expenses: NO_EXPENSES, tax: USN_6 });

const PRODUCTS = new Map([
  ['V1', { name: 'Восток Амфибия' }],
  ['V2', { name: 'Командирские 2414' }],
  ['K1', { name: 'Восток Кремлёвские' }],
  ['C1', { name: 'G-Shock', category: 'Casio' }],
]);

describe('salesAnalyticsOf', () => {
  it('бренды — свёртка товаров по brandOf; Σ брендов + rest = итог', () => {
    const view = salesAnalyticsOf(
      pnl([
        sale({ orderId: 'o1', sku: 'V1', amountKopecks: 300_000, count: 3 }),
        sale({ orderId: 'o2', sku: 'V2' }),
        sale({ orderId: 'o3', sku: 'K1' }),
        sale({ orderId: 'o4', sku: 'C1', amountKopecks: 500_000 }),
        sale({ orderId: 'o5', sku: 'UNKNOWN' }),
        sale({ orderId: null, sku: null, amountKopecks: 70_000 }),
      ]),
      PRODUCTS,
    );

    expect(view.brands.map((b) => [b.key, b.title, b.skus, b.revenueKopecks, b.units])).toEqual([
      ['vostok', 'Восток', 2, 400_000, 4],
      ['casio', 'CASIO', 1, 500_000, 1],
      // «Кремлёвские» исключены из Востока, неизвестный товар — тоже «Остальные».
      [null, OTHER_BRAND_TITLE, 2, 200_000, 2],
    ]);
    expect(view.rest).toEqual({ revenueKopecks: 70_000, units: 1 });
    const brandSum = view.brands.reduce((s, b) => s + b.revenueKopecks, 0) + view.rest.revenueKopecks;
    expect(brandSum).toBe(view.totals.revenueKopecks);
    expect(view.skus[0]).toMatchObject({ sku: 'C1', name: 'G-Shock', brand: 'casio' });
    expect(view.skus.find((s) => s.sku === 'UNKNOWN')).toMatchObject({ name: null, brand: null });
    expect(view.marketplaces).toEqual([{ marketplace: 'ym', ...view.totals }]);
  });

  it('средний чек и скорость; без заказов чек — null, а не 0', () => {
    expect(salesFigures(100_000, 6, 3, 30)).toEqual({
      revenueKopecks: 100_000,
      units: 6,
      orders: 3,
      avgCheckKopecks: 33_333,
      unitsPerDay: 0.2,
    });
    expect(salesFigures(0, 0, 0, 0)).toMatchObject({ avgCheckKopecks: null, unitsPerDay: null });
  });

  it('дней в периоде — включительно', () => {
    expect(periodDaysOf(SEPT)).toBe(30);
    expect(periodDaysOf({ from: '2026-10-05', to: '2026-10-05' })).toBe(1);
    expect(periodDaysOf({ from: '2026-10-05', to: '2026-10-01' })).toBe(0);
  });
});
