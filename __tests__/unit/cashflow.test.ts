import type { IAllocatableExpense } from '../../src/modules/finance/expense-allocation';
import type { IPaidOperation } from '../../src/modules/finance/cashflow';

import { describe, expect, it } from 'vitest';

import {
  cashflowOf,
  expenseCashDays,
  payoutsOf,
  receivableOf,
} from '../../src/modules/finance/cashflow';

/** ДДС, выплаты и «к получению» (TASK-122) — чистые функции. */

const OCT = { from: '2026-10-01', to: '2026-10-31' };
const Q1 = { from: '2027-01-01', to: '2027-03-31' };

const monthly = (over: Partial<IAllocatableExpense> = {}): IAllocatableExpense => ({
  id: 'e1',
  category: 'rent',
  kind: 'monthly',
  amountKopecks: 3_000_000,
  fromDay: '2026-09-05',
  toDay: null,
  ...over,
});

const paid = (over: Partial<IPaidOperation> = {}): IPaidOperation => ({
  id: 'o1',
  article: 'sales',
  amountKopecks: 10_000,
  bankOrderId: 'P1',
  bankSumKopecks: 10_000,
  // 20.10 по Москве.
  paidAt: new Date('2026-10-19T21:00:00Z'),
  ...over,
});

describe('expenseCashDays', () => {
  it('разовый — в свой день, если он в периоде', () => {
    expect(expenseCashDays(monthly({ kind: 'one_off', fromDay: '2026-10-07' }), OCT)).toEqual([
      '2026-10-07',
    ]);
    expect(expenseCashDays(monthly({ kind: 'one_off', fromDay: '2026-09-30' }), OCT)).toEqual([]);
  });

  it('ежемесячный — целиком раз в месяц в число дня начала', () => {
    expect(expenseCashDays(monthly(), OCT)).toEqual(['2026-10-05']);
    // Начало в середине периода: октябрьский платёж — 20-го, раньше нет.
    expect(expenseCashDays(monthly({ fromDay: '2026-10-20' }), OCT)).toEqual(['2026-10-20']);
  });

  it('31-е в феврале — последний день месяца; конец обрезает', () => {
    expect(expenseCashDays(monthly({ fromDay: '2026-12-31' }), Q1)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(expenseCashDays(monthly({ fromDay: '2026-12-31', toDay: '2027-02-27' }), Q1)).toEqual([
      '2027-01-31',
    ]);
  });

  it('день платежа до начала периода в его месяце — не попадает', () => {
    expect(expenseCashDays(monthly(), { from: '2026-10-10', to: '2026-10-31' })).toEqual([]);
  });
});

describe('payoutsOf', () => {
  it('строки одного поручения — одна выплата с суммой поручения', () => {
    const payouts = payoutsOf(
      [
        paid({ id: 'a', amountKopecks: 12_000 }),
        paid({ id: 'b', article: 'commission', amountKopecks: -2_000 }),
      ],
      OCT,
    );
    expect(payouts).toEqual([
      {
        bankOrderId: 'P1',
        day: '2026-10-20',
        kopecks: 10_000,
        linesKopecks: 10_000,
        operationCount: 2,
        mismatch: false,
      },
    ]);
  });

  it('Σ строк ≠ поручению — флаг, в выплату идёт сумма поручения', () => {
    const [payout] = payoutsOf([paid({ amountKopecks: 9_000 })], OCT);
    expect(payout).toMatchObject({ kopecks: 10_000, linesKopecks: 9_000, mismatch: true });
  });

  it('bonus_payment — не деньги; поручение вне периода — не выплата периода', () => {
    const payouts = payoutsOf(
      [
        paid({ id: 'a' }),
        paid({ id: 'b', article: 'bonus_payment', amountKopecks: -500 }),
        paid({ id: 'c', bankOrderId: 'P2', paidAt: new Date('2026-11-02T09:00:00Z') }),
      ],
      OCT,
    );
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ bankOrderId: 'P1', operationCount: 1, mismatch: false });
  });

  it('без номера поручения — по дню, сумма строк', () => {
    const [payout] = payoutsOf(
      [paid({ bankOrderId: null, bankSumKopecks: null }), paid({ id: 'b', bankOrderId: null })],
      OCT,
    );
    expect(payout).toMatchObject({ bankOrderId: null, kopecks: 20_000, mismatch: false });
  });
});

describe('cashflowOf', () => {
  it('Σ корзин = итог; закупки и налоги вне периода отброшены', () => {
    const flow = cashflowOf({
      period: OCT,
      paid: [paid({ amountKopecks: 500_000, bankSumKopecks: 500_000 })],
      purchases: [
        { id: 'p1', supplier: 'Восток', paidDay: '2026-10-03', amountKopecks: 200_000 },
        { id: 'p2', supplier: 'Восток', paidDay: '2026-09-30', amountKopecks: 999_999 },
      ],
      expenses: [
        monthly({ amountKopecks: 100_000 }),
        monthly({
          id: 'e2',
          category: 'packaging',
          kind: 'one_off',
          fromDay: '2026-10-11',
          amountKopecks: 5_000,
        }),
      ],
      taxPayments: [{ id: 't1', paidDay: '2026-10-25', amountKopecks: 30_000 }],
    });
    expect(flow.inflow.payoutsKopecks).toBe(500_000);
    expect(flow.outflow).toEqual({
      purchasesKopecks: 200_000,
      expensesKopecks: 105_000,
      expensesByCategory: { rent: 100_000, packaging: 5_000 },
      taxesKopecks: 30_000,
      totalKopecks: 335_000,
    });
    expect(flow.netKopecks).toBe(500_000 - 335_000);
    expect(flow.purchases.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('receivableOf', () => {
  it('сумма по статьям со знаком, без reference и нулей', () => {
    const receivable = receivableOf([
      { article: 'sales', kopecks: 100_000, operationCount: 3 },
      { article: 'commission', kopecks: -20_000, operationCount: 3 },
      { article: 'bonus_payment', kopecks: -5_000, operationCount: 1 },
      { article: 'storage', kopecks: 0, operationCount: 2 },
    ]);
    expect(receivable.totalKopecks).toBe(80_000);
    expect(receivable.operationCount).toBe(6);
    expect(receivable.byArticle.map((row) => row.article)).toEqual(['sales', 'commission']);
  });
});
