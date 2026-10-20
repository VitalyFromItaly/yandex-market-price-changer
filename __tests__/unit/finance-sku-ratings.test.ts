import type { IExpenseAllocation } from '../../src/modules/finance/expense-allocation';
import type { IFinancePeriod } from '../../src/modules/finance/finance-period';
import type { IPnlLine } from '../../src/modules/finance/pnl';
import type { ITaxSettings } from '../../src/modules/finance/tax.domain';

import { describe, expect, it } from 'vitest';

import { monthPeriod } from '../../src/modules/finance/finance-period';
import { pnlOf } from '../../src/modules/finance/pnl';
import {
  ABC_PROFIT_NO_COST,
  ABC_PROFIT_NOT_POSITIVE,
  abcOf,
  RATING_THRESHOLDS,
  RATING_TOP_KEYS,
  skuRatingsOf,
  variationOf,
  weekIndexOf,
  weeksOf,
  xyzOf,
} from '../../src/modules/finance/sku-ratings';

/** «Рейтинги и классификации» (TASK-141): ТОП-листы, ABC и XYZ над готовым P&L. */

const SEPT = monthPeriod(2026, 9);
const AUG = monthPeriod(2026, 8);
const NO_EXPENSES: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };
const USN_6: ITaxSettings = { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' };

let seq = 0;
function sale(over: Partial<IPnlLine> = {}): IPnlLine {
  seq += 1;
  return {
    id: `op-${seq}`,
    article: 'sales',
    amountKopecks: 100_000,
    sku: 'A',
    count: 1,
    goods: 'sold',
    orderId: `o${seq}`,
    accruedDay: '2026-09-10',
    paidDay: '2026-09-15',
    ...over,
  };
}

/** Закуп 600 ₽ за штуку у всех, кроме NO-COST. */
const flatCost = (sku: string) => (sku === 'NO-COST' ? undefined : 60_000);

const pnl = (period: IFinancePeriod, lines: IPnlLine[]) =>
  pnlOf({ lines, period, costOf: flatCost, expenses: NO_EXPENSES, tax: USN_6 });

describe('ABC', () => {
  it('класс — по доле ДО товара: товар, на котором итог переходит 80 %, ещё A', () => {
    const classes = abcOf(new Map([['a', 70], ['b', 20], ['c', 10]]));
    expect([...classes]).toEqual([['a', 'A'], ['b', 'A'], ['c', 'B']]);
  });

  it('ровно 80 % до товара — уже B, 95 % — C; нули и минусы не классифицируются', () => {
    const classes = abcOf(new Map([['a', 50], ['b', 30], ['c', 15], ['d', 5], ['z', 0], ['m', -10]]));
    expect(Object.fromEntries(classes)).toEqual({ a: 'A', b: 'A', c: 'B', d: 'C' });
  });
});

describe('XYZ', () => {
  it('недели — по 7 дней от начала периода, хвост отбрасывается', () => {
    expect(weeksOf(SEPT)).toBe(4);
    expect(weekIndexOf('2026-09-01', SEPT.from, 4)).toBe(0);
    expect(weekIndexOf('2026-09-28', SEPT.from, 4)).toBe(3);
    expect(weekIndexOf('2026-09-29', SEPT.from, 4)).toBeNull();
    expect(weekIndexOf('2026-08-31', SEPT.from, 4)).toBeNull();
  });

  it('коэффициент вариации и классы по порогам', () => {
    expect(variationOf([1, 1, 1, 1])).toBe(0);
    expect(variationOf([10, 11, 9, 10])).toBeCloseTo(Math.sqrt(0.5) / 10);
    expect(variationOf([0, 0, 0, 4])).toBeCloseTo(Math.sqrt(3));
    expect(variationOf([0, 0, 0, 0])).toBeNull();
    expect(variationOf([1, -1])).toBeNull();
    expect(xyzOf(RATING_THRESHOLDS.xyz.x)).toBe('X');
    expect(xyzOf(RATING_THRESHOLDS.xyz.y)).toBe('Y');
    expect(xyzOf(RATING_THRESHOLDS.xyz.y + 0.01)).toBe('Z');
  });
});

describe('skuRatingsOf', () => {
  // A — по штуке каждую неделю; NO-COST — крупная продажа без закупа; C — в минус;
  // D продавался только в августе.
  const current = pnl(SEPT, [
    sale({ accruedDay: '2026-09-01' }),
    sale({ accruedDay: '2026-09-08' }),
    sale({ accruedDay: '2026-09-15' }),
    sale({ accruedDay: '2026-09-22' }),
    // Хвост 29–30.09 в недели XYZ не идёт, но в штуки периода — идёт.
    sale({ accruedDay: '2026-09-29' }),
    sale({ sku: 'NO-COST', amountKopecks: 900_000 }),
    sale({ sku: 'C', amountKopecks: 50_000 }),
  ]);
  const previous = pnl(AUG, [
    sale({ sku: 'A', accruedDay: '2026-08-05', paidDay: '2026-08-10' }),
    sale({ sku: 'D', count: 3, accruedDay: '2026-08-05', paidDay: '2026-08-10' }),
  ]);
  const ratings = skuRatingsOf(current, previous, new Map([['A', { name: 'Casio GA-2100' }]]));
  const top = (key: string) => ratings.tops.find((t) => t.key === key)?.rows.map((r) => r.sku);
  const sku = (key: string) => ratings.skus.find((r) => r.sku === key);

  it('семь ТОП-листов в порядке экрана, пороги — из одного объекта', () => {
    expect(ratings.tops.map((t) => t.key)).toEqual([...RATING_TOP_KEYS]);
    expect(ratings.thresholds).toBe(RATING_THRESHOLDS);
    expect(sku('A')).toMatchObject({ name: 'Casio GA-2100', brand: 'casio' });
  });

  it('товар без себестоимости не входит в рейтинги прибыли, но входит в выручку', () => {
    expect(top('revenue')).toEqual(['NO-COST', 'A', 'C']);
    expect(top('net')).toEqual(['A']);
    expect(top('margin')).toEqual(['A', 'C']);
    expect(top('loss')).toEqual(['C']);
    expect(sku('NO-COST')).toMatchObject({
      abcRevenue: 'A',
      abcProfit: null,
      abcProfitReason: ABC_PROFIT_NO_COST,
      margin: null,
    });
    expect(sku('C')).toMatchObject({ abcProfit: null, abcProfitReason: ABC_PROFIT_NOT_POSITIVE });
    expect(sku('A')?.abcProfit).toBe('A');
  });

  it('спрос — штуки к прошлому периоду по объединению артикулов', () => {
    expect(sku('A')).toMatchObject({ units: 5, previousUnits: 1, unitsDelta: 4 });
    expect(sku('C')).toMatchObject({ previousUnits: null, unitsDelta: 1 });
    expect(top('growing')).toEqual(['A', 'C', 'NO-COST']);
    // D в сентябре не продавался — падение до нуля, но в классификации его нет.
    expect(top('falling')).toEqual(['D']);
    expect(ratings.tops.find((t) => t.key === 'falling')?.rows[0]).toMatchObject({
      units: 0,
      previousUnits: 3,
      unitsDelta: -3,
    });
    expect(sku('D')).toBeUndefined();
  });

  it('XYZ по полным неделям: ровный спрос — X, разовый — Z', () => {
    expect(ratings.weeks).toBe(4);
    expect(ratings.xyzUnavailable).toBeNull();
    expect(sku('A')).toMatchObject({ weeklyUnits: [1, 1, 1, 1], cv: 0, xyz: 'X' });
    expect(sku('C')).toMatchObject({ weeklyUnits: [0, 1, 0, 0], xyz: 'Z' });
    expect(ratings.xyz.map((c) => [c.key, c.skus])).toEqual([['X', 1], ['Y', 0], ['Z', 2]]);
  });

  it('сводка ABC: Σ по классам = выручке классифицированных товаров', () => {
    const total = ratings.abcRevenue.reduce((s, c) => s + c.kopecks, 0);
    expect(total).toBe(ratings.skus.reduce((s, r) => s + Math.max(r.revenueKopecks, 0), 0));
    expect(ratings.abcRevenue.reduce((s, c) => s + (c.share ?? 0), 0)).toBeCloseTo(1);
  });

  it('период короче четырёх недель — XYZ недоступен с причиной, а не «всё Z»', () => {
    const short = pnl({ from: '2026-09-01', to: '2026-09-20' }, [sale({ accruedDay: '2026-09-02' })]);
    const result = skuRatingsOf(short, previous, new Map());
    expect(result.weeks).toBe(2);
    expect(result.xyzUnavailable).toMatch(/4 полных недель/);
    expect(result.xyz).toEqual([]);
    expect(result.skus[0]).toMatchObject({ xyz: null, cv: null, weeklyUnits: [] });
  });
});
