import { describe, expect, it } from 'vitest';

import { toCashflowModel } from './mapCashflow.finance';

import { formatRub as rub } from '@/shared/utils';

describe('toCashflowModel', () => {
  it('корзины, выплаты и «к получению» — подписями, со знаком у итога', () => {
    const model = toCashflowModel({
      from: '2026-10-01',
      to: '2026-10-31',
      inflow: { payoutsKopecks: 500_000, totalKopecks: 500_000 },
      outflow: {
        purchasesKopecks: 600_000,
        expensesKopecks: 100_000,
        expensesByCategory: [{ key: 'rent', label: 'Аренда', kopecks: 100_000 }],
        taxesKopecks: 0,
        totalKopecks: 700_000,
      },
      netKopecks: -200_000,
      payouts: [
        {
          bankOrderId: 'P1',
          day: '2026-10-05',
          kopecks: 500_000,
          linesKopecks: 500_000,
          operationCount: 2,
          mismatch: false,
        },
        {
          bankOrderId: null,
          day: '2026-10-07',
          kopecks: 1,
          linesKopecks: 1,
          operationCount: 1,
          mismatch: true,
        },
      ],
      receivable: {
        asOf: '2026-10-15',
        totalKopecks: 80_000,
        operationCount: 4,
        byArticle: [{ article: 'sales', label: 'Продажи', kopecks: 80_000, operationCount: 4 }],
      },
    });
    expect(model.rangeLabel).toBe('01-10-2026 — 31-10-2026');
    expect(model.inflowTotal).toBe(rub(5000));
    expect(model.outflow.map((line) => line.amount)).toEqual([rub(6000), rub(1000), rub(0)]);
    expect(model.outflow[1]?.children).toEqual([
      { key: 'rent', label: 'Аренда', amount: rub(1000) },
    ]);
    expect(model.net).toBe(rub(-2000));
    expect(model.netNegative).toBe(true);
    expect(model.payouts.map((p) => [p.day, p.order, p.mismatch])).toEqual([
      ['05-10-2026', 'P1', false],
      ['07-10-2026', 'без номера', true],
    ]);
    expect(model.receivable).toEqual({
      asOf: '15-10-2026',
      total: rub(800),
      isEmpty: false,
      byArticle: [{ key: 'sales', label: 'Продажи', amount: rub(800) }],
    });
  });
});
