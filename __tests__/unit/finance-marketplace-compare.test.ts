import type { IExpenseAllocation } from '../../src/modules/finance/expense-allocation';
import type { IPnlLine } from '../../src/modules/finance/pnl';
import type { ITaxSettings } from '../../src/modules/finance/tax.domain';

import { describe, expect, it } from 'vitest';

import { monthPeriod } from '../../src/modules/finance/finance-period';
import {
  compareMetricsOf,
  conclusionsOf,
  NO_SCHEME_REASON,
  NOT_ENOUGH_MARKETPLACES,
  schemeTotalsOf,
  shareAllocation,
  TIE_REASON,
} from '../../src/modules/finance/marketplace-compare';
import { pnlOf } from '../../src/modules/finance/pnl';
import { OVERVIEW_SERVICE_GROUP, serviceGroupsOf } from '../../src/modules/finance/service-groups';

/** «Сравнение площадок» (TASK-137): доля расходов, показатели и выводы из готовых P&L. */

const SEPT = monthPeriod(2026, 9);
const NONE: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };
const USN_6: ITaxSettings = { regime: 'usn_income', rateBasisPoints: 600, recognition: 'realization' };

let seq = 0;
const line = (over: Partial<IPnlLine>): IPnlLine => {
  seq += 1;
  return {
    id: `op-${seq}`,
    article: 'sales',
    amountKopecks: 100_000,
    orderId: `o-${seq}`,
    sku: 'W-1',
    count: 1,
    goods: 'sold',
    accruedDay: '2026-09-10',
    paidDay: null,
    scheme: 'FBS',
    ...over,
  };
};

const pnl = (lines: IPnlLine[]) =>
  pnlOf({ lines, period: SEPT, costOf: () => 50_000, expenses: NONE, tax: USN_6 });

describe('shareAllocation', () => {
  it('делит итог по весам, Σ долей = итогу; отрицательный вес — ноль', () => {
    const shares = shareAllocation({ totalKopecks: 1_000_001, byCategory: { rent: 1_000_001 }, byExpense: [] }, [
      2,
      1,
      -5,
    ]);
    expect(shares?.map((s) => s.totalKopecks)).toEqual([666_667, 333_334, 0]);
    expect(shares?.reduce((sum, s) => sum + s.totalKopecks, 0)).toBe(1_000_001);
  });

  it('нет выручки нигде — null: делить не по чему', () => {
    expect(shareAllocation({ totalKopecks: 100, byCategory: {}, byExpense: [] }, [0, -1])).toBeNull();
  });
});

describe('compareMetricsOf', () => {
  it('группы услуг = «Обзору», Σ групп = расходам площадки', () => {
    const p = pnl([
      line({ amountKopecks: 1_000_000 }),
      line({ article: 'commission', amountKopecks: -150_000, goods: null, sku: null }),
      line({ article: 'delivery_to_buyer', amountKopecks: -50_000, goods: null, sku: null }),
      line({ article: 'penalties', amountKopecks: -10_000, goods: null, sku: null }),
    ]);
    const m = compareMetricsOf(p);
    expect(m.services).toEqual(serviceGroupsOf(p));
    expect(Object.values(m.services).reduce((a, b) => a + b, 0)).toBe(p.marketplaceKopecks);
    expect(m.commissionShare).toBeCloseTo(0.15);
    expect(m.costShare).toBeCloseTo(0.21);
    expect(Object.keys(OVERVIEW_SERVICE_GROUP)).toContain('commission');
  });
});

describe('conclusionsOf', () => {
  const ym = pnl([line({ amountKopecks: 200_000, sku: 'A' })]);
  const ozon = pnl([line({ amountKopecks: 300_000, sku: 'A', scheme: 'FBO' })]);

  it('одна площадка — сравнивать не с чем, победитель не выдумывается', () => {
    const [revenue] = conclusionsOf([{ marketplace: 'ym', current: ym, previous: null }]);
    expect(revenue).toMatchObject({ winner: null, reason: NOT_ENOUGH_MARKETPLACES });
  });

  it('ничья — без победителя', () => {
    const [revenue] = conclusionsOf([
      { marketplace: 'ym', current: ym, previous: null },
      { marketplace: 'wb', current: pnl([line({ amountKopecks: 200_000, scheme: null })]), previous: null },
    ]);
    expect(revenue).toMatchObject({ winner: null, reason: TIE_REASON });
  });

  it('больше денег и схема — победитель с текстом; рост без прошлого периода — причина', () => {
    const result = conclusionsOf([
      { marketplace: 'ym', current: ym, previous: null },
      { marketplace: 'ozon', current: ozon, previous: null },
    ]);
    const byKind = Object.fromEntries(result.map((c) => [c.kind, c]));
    expect(byKind.revenue.winner).toBe('ozon');
    expect(byKind.revenue.text).toContain('Ozon');
    expect(byKind.scheme).toMatchObject({ winner: 'ozon', scheme: 'FBO' });
    expect(byKind.growth.winner).toBeNull();
    expect(byKind.product.products?.[0]).toMatchObject({ sku: 'A', winner: 'ozon', runnerUp: 'ym' });
  });

  it('схему никто не указал (WB) — «нет данных» про схемы', () => {
    const wb = pnl([line({ scheme: null })]);
    expect(schemeTotalsOf('wb', wb)).toEqual([]);
    const scheme = conclusionsOf([
      { marketplace: 'wb', current: wb, previous: null },
      { marketplace: 'wb', current: pnl([line({ scheme: null })]), previous: null },
    ]).find((c) => c.kind === 'scheme');
    expect(scheme).toMatchObject({ winner: null, reason: NO_SCHEME_REASON });
  });
});
