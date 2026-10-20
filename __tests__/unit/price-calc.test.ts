import type { IPriceCalcInput } from '../../src/shared/price-calc';
import type { IPnlSku } from '../../src/modules/finance/pnl-sku';

import { describe, expect, it } from 'vitest';

import { minPriceOf } from '../../src/modules/crm/unit-economics/crm-unit-economics.domain';
import { priceFor, profitAt } from '../../src/shared/price-calc';

const base: IPriceCalcInput = {
  discountRate: 0,
  commissionRate: 0.2,
  promotionRate: 0.05,
  cogsKopecks: 150_000,
  logisticsKopecks: 25_000,
  otherKopecks: 3_000,
  tax: { mode: 'revenue', rate: 0.06, minRate: 0.01 },
};

/** Округление строк разложения — по копейке на строку. */
const ROUNDING = 4;

describe('price-calc: прямой расчёт', () => {
  it('разложение складывается в прибыль до копейки', () => {
    const r = profitAt(400_000, { ...base, discountRate: 0.1 });
    expect(r.saleKopecks).toBe(360_000);
    expect(r.discountKopecks).toBe(40_000);
    expect(r.commissionKopecks).toBe(72_000);
    expect(r.promotionKopecks).toBe(18_000);
    expect(r.taxKopecks).toBe(21_600);
    expect(r.profitKopecks).toBe(360_000 - 72_000 - 18_000 - 150_000 - 25_000 - 3_000 - 21_600);
    expect(r.margin).toBeCloseTo(r.profitKopecks / 360_000, 10);
  });

  it('«Доходы минус расходы»: налог с разницы, но не меньше минимального', () => {
    const tax = { mode: 'profit' as const, rate: 0.15, minRate: 0.01 };
    const rich = profitAt(500_000, { ...base, tax });
    expect(rich.taxKopecks).toBe(Math.round(0.15 * (500_000 - 125_000 - 178_000)));
    const poor = profitAt(200_000, { ...base, tax });
    expect(poor.taxKopecks).toBe(2_000);
  });

  it('нулевая цена: рентабельности нет', () => {
    expect(profitAt(0, base).margin).toBeNull();
  });
});

describe('price-calc: прямой и обратный расчёт взаимно обратны', () => {
  const taxes = [
    { mode: 'revenue' as const, rate: 0.06, minRate: 0.01 },
    { mode: 'profit' as const, rate: 0.15, minRate: 0.01 },
  ];
  const discounts = [0, 0.15, 0.5];
  const profits = [0, 70_000, 123_456];
  const margins = [0, 0.1, 0.27];

  for (const tax of taxes) {
    for (const discountRate of discounts) {
      const input = { ...base, tax, discountRate };

      it.each(profits)(`прибыль %i коп, налог ${tax.mode}, скидка ${discountRate}`, (kopecks) => {
        const solution = priceFor({ kind: 'profit', kopecks }, input);
        if (!solution.ok) throw new Error(solution.reason);
        const r = profitAt(solution.priceKopecks, input);
        expect(r.profitKopecks).toBeGreaterThanOrEqual(kopecks - ROUNDING);
        expect(r.profitKopecks).toBeLessThanOrEqual(kopecks + ROUNDING);
        // Наименьшая: копейкой дешевле — уже ниже цели (с точностью до округления строк).
        expect(profitAt(solution.priceKopecks - 2, input).profitKopecks).toBeLessThan(kopecks + 1);
      });

      it.each(margins)(`рентабельность %f, налог ${tax.mode}, скидка ${discountRate}`, (rate) => {
        const solution = priceFor({ kind: 'margin', rate }, input);
        if (!solution.ok) throw new Error(solution.reason);
        const r = profitAt(solution.priceKopecks, input);
        expect(r.margin).not.toBeNull();
        expect(r.margin as number).toBeCloseTo(rate, 4);
      });
    }
  }

  it('цена → прибыль → цена возвращает ту же цену', () => {
    for (const price of [250_000, 399_900, 1_000_000]) {
      const { profitKopecks } = profitAt(price, base);
      const back = priceFor({ kind: 'profit', kopecks: profitKopecks }, base);
      if (!back.ok) throw new Error(back.reason);
      expect(Math.abs(back.priceKopecks - price)).toBeLessThanOrEqual(ROUNDING * 2);
    }
  });
});

describe('price-calc: когда цены нет', () => {
  it('скидка 100 % — цены нет', () => {
    expect(priceFor({ kind: 'profit', kopecks: 0 }, { ...base, discountRate: 1 })).toEqual({
      ok: false,
      reason: 'discount',
    });
  });

  it('процентные расходы съедают продажу — ставки', () => {
    expect(priceFor({ kind: 'profit', kopecks: 0 }, { ...base, commissionRate: 0.95 })).toEqual({
      ok: false,
      reason: 'rates',
    });
  });

  it('рентабельность выше возможной — цель', () => {
    expect(priceFor({ kind: 'margin', rate: 0.8 }, base)).toEqual({ ok: false, reason: 'target' });
    expect(priceFor({ kind: 'margin', rate: 1 }, base)).toEqual({ ok: false, reason: 'target' });
  });
});

describe('price-calc: шаг проверки TASK-139', () => {
  it('«цена для 700 ₽ с продажи» при ставках, введённых руками, даёт 700 ₽', () => {
    const manual: IPriceCalcInput = {
      discountRate: 0.1,
      commissionRate: 0.19,
      promotionRate: 0.03,
      cogsKopecks: 120_000,
      logisticsKopecks: 9_000,
      otherKopecks: 0,
      tax: { mode: 'revenue', rate: 0.06, minRate: 0.01 },
    };
    const solution = priceFor({ kind: 'profit', kopecks: 70_000 }, manual);
    if (!solution.ok) throw new Error(solution.reason);
    expect(Math.round(profitAt(solution.priceKopecks, manual).profitKopecks / 100)).toBe(700);
  });
});

describe('price-calc: согласован с minPriceOf unit-экономики', () => {
  it('цена при прибыли 0 = минимальной цене товара (±1 коп)', () => {
    const sku = {
      sku: 'A',
      scheme: 'FBS',
      units: 10,
      orders: 10,
      costKnown: true,
      columns: {
        revenue: 3_000_000,
        otherIncome: 0,
        commission: -600_000,
        logistics: -250_000,
        promotion: -90_000,
        otherServices: -30_000,
        unrecognized: 0,
      },
      cogsKopecks: 1_500_000,
      taxKopecks: 180_000,
      netKopecks: 0,
      schemes: [],
    } as IPnlSku;
    const min = minPriceOf(sku) as number;
    const solution = priceFor(
      { kind: 'profit', kopecks: 0 },
      {
        discountRate: 0,
        commissionRate: 0.2,
        promotionRate: 0.03,
        cogsKopecks: 150_000,
        logisticsKopecks: 25_000,
        otherKopecks: 3_000,
        tax: { mode: 'revenue', rate: 0.06, minRate: 0 },
      },
    );
    if (!solution.ok) throw new Error(solution.reason);
    expect(Math.abs(solution.priceKopecks - min)).toBeLessThanOrEqual(1);
  });
});
