import type { IAllocatableExpense } from '../../src/modules/finance/expense-allocation';

import { describe, expect, it } from 'vitest';

import { allocate, expenseShare } from '../../src/modules/finance/expense-allocation';
import { daysInMonth } from '../../src/modules/yandex/reports/moscow-day';

const rent = (over: Partial<IAllocatableExpense> = {}): IAllocatableExpense => ({
  id: 'rent',
  category: 'rent',
  kind: 'monthly',
  amountKopecks: 3_000_000, // 30 000 ₽
  fromDay: '2026-01-01',
  toDay: null,
  ...over,
});

describe('daysInMonth', () => {
  it('31/30/28/29 — високосный год Date учитывает сам', () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('allocate — ежемесячный расход по дням своего месяца', () => {
  it('полный месяц даёт ровно сумму, в любом месяце', () => {
    for (const [from, to] of [
      ['2026-10-01', '2026-10-31'],
      ['2026-11-01', '2026-11-30'],
      ['2026-02-01', '2026-02-28'],
    ]) {
      expect(expenseShare(rent(), { from, to })).toBe(3_000_000);
    }
  });

  it('неделя внутри октября: 30 000 × 7 / 31 = 6 774,19 ₽ (≈ 7 000 — шаг проверки)', () => {
    const result = allocate([rent()], { from: '2026-10-05', to: '2026-10-11' });
    expect(result.totalKopecks).toBe(677_419);
    expect(Math.abs(result.totalKopecks - 700_000)).toBeLessThan(30_000);
  });

  it('неделя в феврале дороже той же недели в октябре — меньше дней в месяце', () => {
    expect(expenseShare(rent(), { from: '2026-02-02', to: '2026-02-08' })).toBe(750_000);
  });

  it('неделя через границу месяцев складывается из двух кусков со своими делителями', () => {
    // 28–30.11 — 3 дня из 30, 1–4.12 — 4 дня из 31.
    const share = expenseShare(rent(), { from: '2026-11-28', to: '2026-12-04' });
    expect(share).toBe(Math.round((3_000_000 * 3) / 30) + Math.round((3_000_000 * 4) / 31));
    expect(share).toBe(300_000 + 387_097);
  });

  it('квартал = три полных месяца ровно, без накопленной копейки', () => {
    expect(expenseShare(rent(), { from: '2026-10-01', to: '2026-12-31' })).toBe(9_000_000);
  });

  it('начало посреди месяца и конец: считаются только дни действия', () => {
    const expense = rent({ fromDay: '2026-10-16', toDay: '2026-11-15' });
    // Октябрь: 16 дней из 31; ноябрь: 15 из 30.
    expect(expenseShare(expense, { from: '2026-10-01', to: '2026-11-30' })).toBe(
      Math.round((3_000_000 * 16) / 31) + 1_500_000,
    );
    expect(expenseShare(expense, { from: '2026-12-01', to: '2026-12-31' })).toBe(0);
    expect(expenseShare(expense, { from: '2026-09-01', to: '2026-09-30' })).toBe(0);
  });

  it('без конца — действует сколько угодно вперёд', () => {
    expect(expenseShare(rent(), { from: '2030-05-01', to: '2030-05-31' })).toBe(3_000_000);
  });

  it('один день', () => {
    expect(expenseShare(rent(), { from: '2026-10-15', to: '2026-10-15' })).toBe(96_774);
  });
});

describe('allocate — разовый расход и сводка', () => {
  const box: IAllocatableExpense = {
    id: 'box',
    category: 'packaging',
    kind: 'one_off',
    amountKopecks: 1_250_050,
    fromDay: '2026-10-10',
    toDay: null,
  };

  it('разовый — целиком, если день внутри периода (границы включительно), иначе 0', () => {
    expect(expenseShare(box, { from: '2026-10-10', to: '2026-10-10' })).toBe(1_250_050);
    expect(expenseShare(box, { from: '2026-10-01', to: '2026-10-09' })).toBe(0);
    expect(expenseShare(box, { from: '2026-10-11', to: '2026-10-31' })).toBe(0);
  });

  it('Σ по категориям = Σ по записям = итог; нулевые доли не попадают в разбивку', () => {
    const custom: IAllocatableExpense = {
      ...box,
      id: 'custom',
      category: 'uuid-1',
      fromDay: '2025-01-01',
    };
    const result = allocate([rent(), rent({ id: 'rent-2' }), box, custom], {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(result.byCategory).toEqual({ rent: 6_000_000, packaging: 1_250_050 });
    const byCategory = Object.values(result.byCategory).reduce((a, b) => a + b, 0);
    const byExpense = result.byExpense.reduce((a, b) => a + b.kopecks, 0);
    expect(byCategory).toBe(result.totalKopecks);
    expect(byExpense).toBe(result.totalKopecks);
    expect(result.byExpense.map((x) => x.id)).toEqual(['rent', 'rent-2', 'box']);
  });

  it('пустой список — нули', () => {
    expect(allocate([], { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      totalKopecks: 0,
      byCategory: {},
      byExpense: [],
    });
  });
});
