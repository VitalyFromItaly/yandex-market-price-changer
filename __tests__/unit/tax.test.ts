import type { ITaxSettings } from '../../src/modules/finance/tax.domain';
import type { ITaxRevenueLine } from '../../src/modules/finance/tax';

import { describe, expect, it } from 'vitest';

import { FINANCE_ARTICLE_META } from '../../src/modules/finance/finance-articles';
import { DEFAULT_TAX_SETTINGS } from '../../src/modules/finance/tax.domain';
import { TAX_BASE_ARTICLES, taxOf } from '../../src/modules/finance/tax';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const line = (
  article: ITaxRevenueLine['article'],
  rub: number,
  paidDay: string | null = '2026-10-10',
  realizedDay: string | null = '2026-10-05',
): ITaxRevenueLine => ({ article, amountKopecks: Math.round(rub * 100), paidDay, realizedDay });

const minusExpenses: ITaxSettings = {
  regime: 'usn_income_minus_expenses',
  rateBasisPoints: 1500,
  recognition: 'payment',
};

describe('taxOf', () => {
  it('УСН 6 % — от дохода до комиссий, а не от выплаты площадки', () => {
    // Продажи 10 000 + субсидии 1 000, Маркет удержал 2 300 комиссии и 500
    // доставки: выплата 8 200, но налог — с 11 000.
    const lines = [
      line('sales', 10_000),
      line('subsidies', 1_000),
      line('commission', -2_300),
      line('delivery_to_buyer', -500),
    ];
    const result = taxOf(DEFAULT_TAX_SETTINGS, lines, OCTOBER);
    expect(result.incomeKopecks).toBe(1_100_000);
    expect(result.baseKopecks).toBe(1_100_000);
    expect(result.taxKopecks).toBe(66_000);
    expect(result.minimumApplied).toBe(false);
  });

  it('возврат уменьшает базу, бонусные списания и unknown — не доход', () => {
    const lines = [
      line('sales', 10_000),
      line('returns', -2_000),
      line('bonus_payment', 5_000),
      line('unknown', 3_000),
    ];
    expect(taxOf(DEFAULT_TAX_SETTINGS, lines, OCTOBER).incomeKopecks).toBe(800_000);
  });

  it('день — по дате признания; строка без даты не в периоде, но посчитана', () => {
    // Продана в сентябре, деньги пришли в октябре.
    const lines = [
      line('sales', 1_000, '2026-10-02', '2026-09-28'),
      line('sales', 500, null, '2026-10-03'),
    ];
    const byPayment = taxOf(DEFAULT_TAX_SETTINGS, lines, OCTOBER);
    expect(byPayment.incomeKopecks).toBe(100_000);
    expect(byPayment.undatedLines).toBe(1);

    const byRealization = taxOf(
      { ...DEFAULT_TAX_SETTINGS, recognition: 'realization' },
      lines,
      OCTOBER,
    );
    expect(byRealization.incomeKopecks).toBe(50_000);
    expect(byRealization.undatedLines).toBe(0);
  });

  it('у «Доходов» расходы к вычету игнорируются', () => {
    const result = taxOf(DEFAULT_TAX_SETTINGS, [line('sales', 10_000)], OCTOBER, 900_000);
    expect(result.deductibleKopecks).toBe(0);
    expect(result.taxKopecks).toBe(60_000);
  });

  it('«Доходы минус расходы» 15 %: налог с разницы', () => {
    const result = taxOf(minusExpenses, [line('sales', 100_000)], OCTOBER, 6_000_000);
    expect(result.baseKopecks).toBe(4_000_000);
    expect(result.regularKopecks).toBe(600_000);
    expect(result.minimumKopecks).toBe(100_000);
    expect(result.taxKopecks).toBe(600_000);
    expect(result.minimumApplied).toBe(false);
  });

  it('минимальный налог 1 % от доходов, база не уходит в минус', () => {
    const small = taxOf(minusExpenses, [line('sales', 100_000)], OCTOBER, 9_500_000);
    expect(small.regularKopecks).toBe(75_000);
    expect(small.taxKopecks).toBe(100_000);
    expect(small.minimumApplied).toBe(true);

    const loss = taxOf(minusExpenses, [line('sales', 100_000)], OCTOBER, 20_000_000);
    expect(loss.baseKopecks).toBe(0);
    expect(loss.taxKopecks).toBe(100_000);
  });

  it('округление до копейки — один раз, на итог', () => {
    // 7 строк по 5 коп.: 35 коп. × 6 % = 2,1 → 2 коп. Округление по строке
    // дало бы 7 × round(0,3) = 0 — налог потерялся бы целиком.
    const lines = Array.from({ length: 7 }, () => line('sales', 0.05));
    expect(taxOf(DEFAULT_TAX_SETTINGS, lines, OCTOBER).taxKopecks).toBe(2);
  });

  it('у каждой статьи журнала есть решение о базе; доход — только из группы income', () => {
    for (const [article, meta] of Object.entries(FINANCE_ARTICLE_META)) {
      if (TAX_BASE_ARTICLES[article as keyof typeof TAX_BASE_ARTICLES]) {
        expect(meta.group, article).toBe('income');
      }
    }
    expect(Object.keys(TAX_BASE_ARTICLES).sort()).toEqual(Object.keys(FINANCE_ARTICLE_META).sort());
  });
});
