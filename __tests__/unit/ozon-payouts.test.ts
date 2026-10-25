import { describe, expect, it } from 'vitest';

import type { IOzonPayoutLine } from '../../src/modules/finance/ozon-payouts';

import { ozonPaidDays } from '../../src/modules/finance/ozon-payouts';

/**
 * Раскладка выплат Ozon по строкам журнала (TASK-184): FIFO — сначала сальдо
 * на начало месяца, затем строки по дате начисления.
 */

const line = (
  id: string,
  kopecks: number,
  day: string,
  article: IOzonPayoutLine['article'] = 'sales',
): IOzonPayoutLine => ({
  id,
  article,
  amountKopecks: kopecks,
  accruedAt: new Date(`${day}T12:00:00+03:00`),
});

describe('ozonPaidDays', () => {
  it('выплаты гасят сначала сальдо, затем строки по дате начисления', () => {
    const lines = [line('b', 500, '2026-10-03'), line('a', 300, '2026-10-02')];
    const { paid, uncovered } = ozonPaidDays(lines, 1000, [
      { day: '2026-10-05', kopecks: 1200 },
      { day: '2026-10-12', kopecks: 600 },
    ]);
    // 1200 − 1000 сальдо = 200 < 300: строка «a» ждёт второй выплаты.
    expect([...paid]).toEqual([
      ['a', '2026-10-12'],
      ['b', '2026-10-12'],
    ]);
    expect(uncovered).toBe(0);
  });

  it('удержание выплачивается вместе со строками до него; хвост ждёт выплаты', () => {
    const lines = [
      line('sale', 1000, '2026-10-01'),
      line('fee', -200, '2026-10-02', 'commission'),
      line('late', 500, '2026-10-03'),
    ];
    const { paid, uncovered } = ozonPaidDays(lines, 0, [{ day: '2026-10-10', kopecks: 1000 }]);
    // Порог «fee» — 1000 (максимум накопленного), а не 800.
    expect([...paid.keys()]).toEqual(['sale', 'fee']);
    expect(uncovered).toBe(1);
  });

  it('строку, начисленную позже дня выплаты, выплата не покрывает', () => {
    const { paid } = ozonPaidDays([line('x', 100, '2026-10-20')], 0, [
      { day: '2026-10-05', kopecks: 5000 },
    ]);
    expect(paid.size).toBe(0);
  });

  it('строки reference (бонусы) — не деньги: вне раскладки и вне счёта', () => {
    const { paid, uncovered } = ozonPaidDays(
      [line('bonus', 999, '2026-10-01', 'bonus_payment'), line('s', 100, '2026-10-01')],
      0,
      [{ day: '2026-10-02', kopecks: 100 }],
    );
    expect([...paid.keys()]).toEqual(['s']);
    expect(uncovered).toBe(0);
  });

  it('нет выплат — ничего не выплачено', () => {
    expect(ozonPaidDays([line('s', 100, '2026-10-01')], 0, []).uncovered).toBe(1);
  });
});
