import type {
  IFifoSale,
  TLotSaleCost,
  TReturnCondition,
} from '../../src/modules/accounting/accounting-lots.domain';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IPurchaseLine } from '../../src/modules/finance/purchase.domain';

import { describe, expect, it } from 'vitest';

import {
  extraForUnits,
  extraShares,
  fifoAllocate,
  fifoAllocateWithRemaining,
  lotsOfPurchase,
} from '../../src/modules/accounting/accounting-lots.domain';
import { fifoSaleOf } from '../../src/modules/accounting/order-result';
import { validatePurchaseInput } from '../../src/modules/finance/purchase.domain';

/** Партии «Финучёта» (TASK-214): разнесение доставки и доли на штуки — чистые функции. */

const line = (sku: string, count: number, priceKopecks: number): IPurchaseLine => ({
  sku,
  name: null,
  count,
  priceKopecks,
});
const sum = (parts: readonly number[]) => parts.reduce((total, part) => total + part, 0);

describe('extraShares', () => {
  it('1 000,01 ₽ доставки на 3 строки — сумма до копейки', () => {
    const lines = [line('A', 1, 100_00), line('B', 1, 100_00), line('C', 1, 100_00)];
    const value = extraShares(lines, 100_001, 'value');
    const count = extraShares(lines, 100_001, 'count');
    expect(sum(value)).toBe(100_001);
    expect(sum(count)).toBe(100_001);
    // Остаток копейки — первой строке при равных долях, детерминированно.
    expect(value).toEqual([33_334, 33_334, 33_333]);
  });

  it('по стоимости и по штукам — разные веса', () => {
    // A: 1 шт × 800 ₽ = 800 ₽, B: 4 шт × 50 ₽ = 200 ₽.
    const lines = [line('A', 1, 800_00), line('B', 4, 50_00)];
    expect(extraShares(lines, 1_000_00, 'value')).toEqual([800_00, 200_00]);
    expect(extraShares(lines, 1_000_00, 'count')).toEqual([200_00, 800_00]);
  });

  it('расходов нет — нули, splitKopecks не зовётся', () => {
    expect(extraShares([line('A', 2, 5_00)], 0, 'value')).toEqual([0]);
    expect(extraShares([], 1_00, 'value')).toEqual([]);
  });
});

describe('lotsOfPurchase', () => {
  const purchase = {
    paidDay: '2026-11-01',
    lines: [line('A', 3, 100_00), line('X', 1, 50_00)],
    deliveryKopecks: 70_00,
    otherCostsKopecks: 1,
    lotCostSplit: 'value' as const,
  };

  it('строка → партия: остаток = количество, товар по артикулу, нет товара → null', () => {
    const lots = lotsOfPurchase(purchase, new Map([['A', 'product-a']]));
    expect(lots).toEqual([
      {
        lineIndex: 0,
        productId: 'product-a',
        sku: 'A',
        name: null,
        count: 3,
        remaining: 3,
        unitPriceKopecks: 100_00,
        extraKopecks: 60_01,
        receivedDay: '2026-11-01',
      },
      expect.objectContaining({ lineIndex: 1, productId: null, sku: 'X', extraKopecks: 10_00 }),
    ]);
    expect(sum(lots.map((lot) => lot.extraKopecks))).toBe(70_01);
  });

  it('закупка без строк партий не порождает', () => {
    expect(lotsOfPurchase({ ...purchase, lines: null }, new Map())).toEqual([]);
  });
});

describe('extraForUnits', () => {
  it('порции в сумме дают ровно долю партии', () => {
    const lot = { count: 3, extraKopecks: 100_01 };
    const parts = [extraForUnits(lot, 0, 1), extraForUnits(lot, 1, 1), extraForUnits(lot, 2, 1)];
    expect(sum(parts)).toBe(100_01);
    expect(extraForUnits(lot, 0, 3)).toBe(100_01);
    expect(extraForUnits(lot, 1, 2)).toBe(parts[1] + parts[2]);
  });

  it('штук больше, чем в партии, — ошибка', () => {
    expect(() => extraForUnits({ count: 2, extraKopecks: 1 }, 1, 2)).toThrow();
  });
});

describe('validatePurchaseInput — доставка и прочие расходы', () => {
  const base = {
    supplier: 'ООО Восток',
    paidDay: '2026-11-01',
    amount: 300,
    lines: [{ sku: 'A', count: 3, price: 100 }],
  };

  it('не присланные поля не попадают в значение — правка их не перезапишет', () => {
    const checked = validatePurchaseInput(base);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value).not.toHaveProperty('deliveryKopecks');
      expect(checked.value).not.toHaveProperty('lotCostSplit');
    }
  });

  it('рубли → копейки, пусто → 0, сумма закупки не меняется', () => {
    const checked = validatePurchaseInput({
      ...base,
      delivery: '1 000,01',
      otherCosts: '',
      lotCostSplit: 'count',
    });
    expect(checked).toMatchObject({
      ok: true,
      value: {
        amountKopecks: 300_00,
        deliveryKopecks: 100_001,
        otherCostsKopecks: 0,
        lotCostSplit: 'count',
      },
    });
  });

  it('ошибки — под своим полем', () => {
    expect(validatePurchaseInput({ ...base, delivery: -1 })).toMatchObject({ field: 'delivery' });
    expect(validatePurchaseInput({ ...base, otherCosts: 'abc' })).toMatchObject({
      field: 'otherCosts',
    });
    expect(validatePurchaseInput({ ...base, lotCostSplit: 'weight' })).toMatchObject({
      field: 'lotCostSplit',
    });
    expect(
      validatePurchaseInput({ ...base, lines: undefined, amount: 300, delivery: 10 }),
    ).toMatchObject({ field: 'lines' });
  });
});

/** FIFO режима Б (TASK-215): списание с нуля, детерминировано, возврат восстанавливает партию. */
describe('fifoAllocate', () => {
  const lot = (id: string, receivedDay: string, count: number, price: number, extra = 0) => ({
    id,
    productId: 'P',
    count,
    unitPriceKopecks: price,
    extraKopecks: extra,
    receivedDay,
  });
  const at = (day: string) => new Date(`${day}T23:59:59.999+03:00`);
  const sale = (
    key: string,
    day: string,
    count = 1,
    returned: { day: string; condition: TReturnCondition } | null = null,
  ): IFifoSale => ({
    key,
    productId: 'P',
    count,
    moment: at(day),
    returned: returned ? { moment: at(returned.day), condition: returned.condition } : null,
  });
  const kopecksOf = (result: Map<string, TLotSaleCost>, key: string) => {
    const cost = result.get(key);
    return cost?.status === 'known' ? cost.kopecks : null;
  };

  // Две партии: 2 шт по 1 500 ₽ (1 октября) и 2 шт по 1 800 ₽ (3 октября).
  const LOTS = [lot('L1', '2026-10-01', 2, 150_000), lot('L2', '2026-10-03', 2, 180_000)];

  it('шаг 1: три продажи и пригодный возврат — восстановленная штука уходит следующей по 1 500', () => {
    const sales = [
      sale('s1', '2026-10-02'),
      sale('s2', '2026-10-04', 1, { day: '2026-10-05', condition: 'fit' }),
      sale('s3', '2026-10-06', 2),
    ];
    const result = fifoAllocate(LOTS, sales);
    expect(kopecksOf(result, 's1')).toBe(150_000);
    // s2 брала вторую штуку L1, вернулась пригодной — L1 снова 1 шт.
    expect(kopecksOf(result, 's2')).toBe(150_000);
    expect(result.get('s2')?.returned).toEqual({ condition: 'fit', restored: true });
    // s3: восстановленная штука L1 (1 500) + одна из L2 (1 800).
    expect(kopecksOf(result, 's3')).toBe(330_000);
    const s3 = result.get('s3');
    expect(s3?.status === 'known' ? s3.portions.map((p) => [p.lotId, p.units]) : null).toEqual([
      ['L1', 1],
      ['L2', 1],
    ]);
  });

  it('без возврата третья продажа берёт уже вторую партию', () => {
    const result = fifoAllocate(LOTS, [
      sale('s1', '2026-10-02'),
      sale('s2', '2026-10-04'),
      sale('s3', '2026-10-06'),
    ]);
    expect([kopecksOf(result, 's1'), kopecksOf(result, 's2'), kopecksOf(result, 's3')]).toEqual([
      150_000, 150_000, 180_000,
    ]);
  });

  it('идемпотентно: перестановка продаж и повторный расчёт — тот же результат', () => {
    const sales = [
      sale('s1', '2026-10-02'),
      sale('s2', '2026-10-04', 1, { day: '2026-10-05', condition: 'fit' }),
      sale('s3', '2026-10-06', 2),
    ];
    const first = fifoAllocate(LOTS, sales);
    const again = fifoAllocate(LOTS, [...sales].reverse());
    expect([...again.entries()].sort()).toEqual([...first.entries()].sort());
  });

  it('повреждённый возврат партию не восстанавливает', () => {
    const result = fifoAllocate(LOTS, [
      sale('s1', '2026-10-02', 1, { day: '2026-10-03', condition: 'damaged' }),
      sale('s2', '2026-10-04', 2),
    ]);
    expect(result.get('s1')?.returned).toEqual({ condition: 'damaged', restored: false });
    expect(kopecksOf(result, 's1')).toBe(150_000);
    // Вторая штука L1 + первая L2: повреждённая в партию не вернулась.
    expect(kopecksOf(result, 's2')).toBe(330_000);
  });

  it('неизвестное состояние возврата — принимается пригодным', () => {
    const result = fifoAllocate(LOTS, [
      sale('s1', '2026-10-02', 2, { day: '2026-10-03', condition: 'unknown' }),
      sale('s2', '2026-10-04', 2),
    ]);
    expect(result.get('s1')?.returned).toEqual({ condition: 'unknown', restored: true });
    expect(kopecksOf(result, 's2')).toBe(300_000);
  });

  it('партий не хватило — «Неизвестная закупка» (no-lot), без отката на прайс', () => {
    const result = fifoAllocate(LOTS, [sale('s1', '2026-10-04', 5)]);
    expect(result.get('s1')).toMatchObject({ status: 'unknown', reason: 'no-lot' });
  });

  it('партия, поступившая позже продажи, не берётся', () => {
    const result = fifoAllocate(LOTS, [sale('s1', '2026-10-02', 3)]);
    expect(result.get('s1')).toMatchObject({ status: 'unknown', reason: 'no-lot' });
    // Недостача списала доступное: следующая продажа берёт уже L2.
    const next = fifoAllocate(LOTS, [sale('s1', '2026-10-02', 3), sale('s2', '2026-10-04')]);
    expect(kopecksOf(next, 's2')).toBe(180_000);
  });

  it('партия без товара и продажа без товара в FIFO не участвуют', () => {
    const result = fifoAllocate(
      [{ ...lot('L0', '2026-10-01', 5, 100_000), productId: null }, ...LOTS],
      [sale('s1', '2026-10-02'), { ...sale('s2', '2026-10-02'), productId: null }],
    );
    expect(kopecksOf(result, 's1')).toBe(150_000);
    expect(result.get('s2')).toMatchObject({ status: 'unknown', reason: 'no-product' });
  });

  it('нет момента продажи — no-sale-moment', () => {
    const result = fifoAllocate(LOTS, [{ ...sale('s1', '2026-10-02'), moment: null }]);
    expect(result.get('s1')).toMatchObject({ status: 'unknown', reason: 'no-sale-moment' });
  });

  it('доп. расходы партии: Σ списаний = цена × штуки + extra, и после возврата тоже', () => {
    const lots = [lot('L', '2026-10-01', 3, 100_000, 1_000)];
    const result = fifoAllocate(lots, [
      sale('a', '2026-10-02', 1, { day: '2026-10-03', condition: 'fit' }),
      sale('b', '2026-10-02'),
      sale('c', '2026-10-04'),
      sale('d', '2026-10-05'),
    ]);
    const sold = ['b', 'c', 'd'].map((key) => kopecksOf(result, key) ?? 0);
    expect(sum(sold)).toBe(300_000 + 1_000);
    // Восстановленная штука ушла по своей цене — той, что списала продажа a.
    expect(kopecksOf(result, 'c')).toBe(kopecksOf(result, 'a'));
  });

  describe('остатки партий (TASK-216)', () => {
    const remainingOf = (lots: Parameters<typeof fifoAllocate>[0], sales: IFifoSale[]) =>
      Object.fromEntries(fifoAllocateWithRemaining(lots, sales).remaining);

    it('себестоимость та же, что у fifoAllocate; остаток — после продаж', () => {
      const sales = [sale('s1', '2026-10-02'), sale('s2', '2026-10-04', 2)];
      const allocation = fifoAllocateWithRemaining(LOTS, sales);
      expect([...allocation.costs.entries()]).toEqual([...fifoAllocate(LOTS, sales).entries()]);
      expect(remainingOf(LOTS, sales)).toEqual({ L1: 0, L2: 1 });
    });

    it('пригодный (и неизвестный) возврат возвращает штуки, повреждённый — нет', () => {
      expect(
        remainingOf(LOTS, [
          sale('s1', '2026-10-02', 1, { day: '2026-10-03', condition: 'unknown' }),
        ]),
      ).toEqual({ L1: 2, L2: 2 });
      expect(
        remainingOf(LOTS, [
          sale('s1', '2026-10-02', 1, { day: '2026-10-03', condition: 'damaged' }),
        ]),
      ).toEqual({ L1: 1, L2: 2 });
    });

    it('недостача (no-lot) списывает доступное до нуля, не в минус', () => {
      expect(remainingOf(LOTS, [sale('s1', '2026-10-04', 5)])).toEqual({ L1: 0, L2: 0 });
    });

    it('партия без товара не списывается — остаток = количество', () => {
      const lots = [{ ...lot('L0', '2026-10-01', 5, 100_000), productId: null }, ...LOTS];
      expect(remainingOf(lots, [sale('s1', '2026-10-02')])).toEqual({ L0: 5, L1: 1, L2: 2 });
    });
  });
});

describe('fifoSaleOf', () => {
  const orderLine = (partial: Partial<IAccountingOrderLineInput>): IAccountingOrderLineInput => ({
    marketplace: 'ym',
    orderId: '100',
    itemId: '1',
    campaignId: null,
    offerId: 'A1',
    offerName: null,
    count: 2,
    priceKopecks: null,
    buyerPriceKopecks: null,
    buyerPriceBeforeDiscountKopecks: null,
    marketplaceSubsidyKopecks: null,
    sellerDiscountKopecks: null,
    revenueKopecks: null,
    payoutKopecks: null,
    commissionKopecks: null,
    status: 'DELIVERED',
    substatus: null,
    createdOn: '2026-10-05',
    soldOn: null,
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  });

  it('отменённая позиция не списывает', () => {
    expect(fifoSaleOf(orderLine({ status: 'CANCELLED' }), 'P')).toBeNull();
  });

  it('возврат — концом дня возврата, без дня (Ozon) — моментом продажи, состояние unknown', () => {
    const withDay = fifoSaleOf(orderLine({ status: 'RETURNED', returnedOn: '2026-10-09' }), 'P');
    expect(withDay?.returned).toEqual({
      moment: new Date('2026-10-09T23:59:59.999+03:00'),
      condition: 'unknown',
    });
    const noDay = fifoSaleOf(orderLine({ status: 'returned' }), 'P');
    expect(noDay?.returned?.moment).toEqual(noDay?.moment);
    expect(noDay?.key).toBe('ym|100|1');
  });

  it('состояние возврата берётся из строки (TASK-238), null — unknown', () => {
    const damaged = fifoSaleOf(
      orderLine({ status: 'RETURNED', returnedOn: '2026-10-09', returnCondition: 'damaged' }),
      'P',
    );
    expect(damaged?.returned?.condition).toBe('damaged');
    const blank = fifoSaleOf(
      orderLine({ status: 'RETURNED', returnedOn: '2026-10-09', returnCondition: null }),
      'P',
    );
    expect(blank?.returned?.condition).toBe('unknown');
  });
});
