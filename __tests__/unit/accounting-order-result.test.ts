import type { IAccountingCostRecord } from '../../src/modules/accounting/accounting-cost-history.domain';
import type { TLotSaleCost } from '../../src/modules/accounting/accounting-lots.domain';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type {
  IOrderResult,
  IOrderResultOperation,
  TOrderCostOf,
  TOrderResultKey,
} from '../../src/modules/accounting/order-result';
import type { IDiscountConfig } from '../../src/modules/yandex/reports/profit';

import { describe, expect, it, vi } from 'vitest';

import { accountingUnitCost } from '../../src/modules/accounting/accounting-cost-history.domain';
import {
  ORDER_RESULT_KEY_OF_ARTICLE,
  RETURN_ASSUMED_FIT_NOTE,
  orderResultOf,
  saleMomentOf,
} from '../../src/modules/accounting/order-result';
import { FINANCE_ARTICLE_KEYS } from '../../src/modules/finance/finance-articles';

/**
 * Результат заказа «Финучёта» (TASK-217): приёмки ТЗ п.15 №1, №4, №5 на
 * обезличенных фикстурах, источник каждой суммы, неизвестная закупка.
 */

const DAY = new Date('2026-10-05T09:00:00Z');
const NO_DISCOUNTS: IDiscountConfig = { defaultPercent: 0, brandPercents: {} };

function op(partial: Partial<IOrderResultOperation>): IOrderResultOperation {
  return {
    id: 'op',
    article: 'commission',
    amountKopecks: 0,
    orderId: '100',
    sku: null,
    serviceName: null,
    transactionType: 'Удержание',
    transactionSource: null,
    accruedAt: DAY,
    paidAt: null,
    actDate: null,
    model: 'FBS',
    count: null,
    marketplace: 'ym',
    origin: 'journal',
    ...partial,
  };
}

function line(partial: Partial<IAccountingOrderLineInput>): IAccountingOrderLineInput {
  return {
    marketplace: 'ym',
    orderId: '100',
    itemId: '1',
    campaignId: null,
    offerId: 'A1',
    offerName: 'Товар',
    count: 1,
    priceKopecks: 100_000,
    buyerPriceKopecks: 100_000,
    buyerPriceBeforeDiscountKopecks: null,
    marketplaceSubsidyKopecks: 0,
    sellerDiscountKopecks: null,
    revenueKopecks: 100_000,
    payoutKopecks: null,
    commissionKopecks: null,
    status: 'DELIVERED',
    substatus: null,
    createdOn: '2026-10-05',
    soldOn: '2026-10-07',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  };
}

const rec = (iso: string, price: number): IAccountingCostRecord => ({
  validFrom: new Date(iso),
  purchase: { price, currency: 'RUR' },
  source: 'price-list',
});

/** Себестоимость v2 по артикулу — тот же `accountingUnitCost`, что у сервиса. */
function costBy(records: Record<string, IAccountingCostRecord[]>): TOrderCostOf {
  return (l, moment) => {
    if (!l.offerId || !records[l.offerId]) return { status: 'unknown', reason: 'no-product' };
    return accountingUnitCost({}, records[l.offerId], NO_DISCOUNTS, moment);
  };
}

const COST_400 = costBy({ A1: [rec('2026-10-01T00:00:00+03:00', 400)] });

function amount(result: IOrderResult, key: TOrderResultKey) {
  return result.amounts.find((a) => a.key === key);
}

/** Итог строк карточки = чистая прибыль, без расхождения округления. */
function expectNetIsSumOfAmounts(result: IOrderResult): void {
  const sum = result.amounts.reduce((s, a) => s + (a.kopecks ?? 0), 0);
  expect(result.net.kopecks).toBe(sum);
  for (const a of result.amounts) {
    if (a.kopecks !== null) expect(Number.isInteger(a.kopecks)).toBe(true);
  }
}

function ymOrder(orderId: string, saleKopecks: number, commissionKopecks: number) {
  return {
    marketplace: 'ym' as const,
    orderId,
    lines: [line({ orderId, revenueKopecks: saleKopecks, priceKopecks: saleKopecks })],
    operations: [
      op({ id: `${orderId}-sale`, orderId, article: 'sales', amountKopecks: saleKopecks }),
      op({
        id: `${orderId}-fee`,
        orderId,
        article: 'commission',
        amountKopecks: -commissionKopecks,
      }),
      op({ id: `${orderId}-dlv`, orderId, article: 'delivery_to_buyer', amountKopecks: -9_900 }),
    ],
    costOf: COST_400,
  };
}

describe('orderResultOf — карта статей', () => {
  it('каждая статья журнала стоит в карточке или справочно', () => {
    for (const article of FINANCE_ARTICLE_KEYS) {
      expect(ORDER_RESULT_KEY_OF_ARTICLE[article]).toBeDefined();
    }
    expect(ORDER_RESULT_KEY_OF_ARTICLE.bonus_payment).toBe('reference');
    expect(ORDER_RESULT_KEY_OF_ARTICLE.subsidies).toBe('revenue');
    expect(ORDER_RESULT_KEY_OF_ARTICLE.compensations).toBe('compensations');
  });
});

describe('приёмка №1 — комиссия из операций, а не процентом', () => {
  // 12 заказов с одной ценой и разными фактическими комиссиями: процент дал бы одно число.
  const commissions = [
    1_234, 5_000, 7_777, 12_001, 3_300, 9_999, 15_050, 4_444, 8_080, 11_111, 2_020, 6_565,
  ];
  const results = commissions.map((fee, i) => orderResultOf(ymOrder(`Y${i}`, 200_000, fee)));

  it('у каждого заказа комиссия = его операция, источник actual, id операции', () => {
    results.forEach((result, i) => {
      const commission = amount(result, 'commission');
      expect(commission).toMatchObject({
        kopecks: -commissions[i],
        source: 'actual',
        operationIds: [`Y${i}-fee`],
      });
      // Чистая прибыль: 2000 − комиссия − 99 доставки − 400 закупа.
      expect(result.net).toEqual({
        kopecks: 200_000 - commissions[i] - 9_900 - 40_000,
        source: 'actual',
        unknown: null,
      });
      expectNetIsSumOfAmounts(result);
    });
    expect(new Set(results.map((r) => amount(r, 'commission')?.kopecks)).size).toBe(12);
  });

  it('у ЯМ без операции комиссии — unknown и прибыль null, не процент', () => {
    const order = ymOrder('Y-nofee', 200_000, 0);
    const result = orderResultOf({
      ...order,
      operations: order.operations.filter((o) => o.article !== 'commission'),
    });
    expect(amount(result, 'commission')).toMatchObject({ kopecks: null, source: 'unknown' });
    expect(result.net).toEqual({
      kopecks: null,
      source: 'unknown',
      unknown: { key: 'commission', reason: 'no-operations' },
    });
  });
});

describe('приёмка №4 — Ozon: цена покупателя, цена продавца, признанный доход', () => {
  // Цена продавца 1000 ₽, покупатель платит 800 ₽, 200 ₽ — скидка за счёт Озон.
  const ozonLine = line({
    marketplace: 'ozon',
    orderId: 'P-1',
    itemId: '777',
    priceKopecks: 100_000,
    buyerPriceKopecks: 80_000,
    marketplaceSubsidyKopecks: 20_000,
    revenueKopecks: 100_000,
    payoutKopecks: 85_000,
    commissionKopecks: 15_000,
    status: 'delivered',
    source: 'ozon-postings',
  });
  const ozonOp = (partial: Partial<IOrderResultOperation>) =>
    op({ orderId: 'P-1', marketplace: 'ozon', ...partial });

  it('скидка площадки не уменьшает выручку продавца, цены различаются', () => {
    const result = orderResultOf({
      marketplace: 'ozon',
      orderId: 'P-1',
      lines: [ozonLine],
      operations: [
        ozonOp({ id: 'o1', article: 'sales', amountKopecks: 100_000 }),
        ozonOp({ id: 'o1', article: 'commission', amountKopecks: -15_000 }),
        ozonOp({ id: 'o2', article: 'delivery_to_buyer', amountKopecks: -7_600 }),
      ],
      costOf: COST_400,
    });
    expect(result.prices).toEqual({
      buyerKopecks: 80_000,
      sellerKopecks: 100_000,
      recognizedKopecks: 100_000,
      marketplaceDiscountKopecks: 20_000,
    });
    expect(amount(result, 'revenue')).toMatchObject({ kopecks: 100_000, source: 'actual' });
    // Части одной сводной операции — один id.
    expect(amount(result, 'commission')?.operationIds).toEqual(['o1']);
    expect(result.net.kopecks).toBe(100_000 - 15_000 - 7_600 - 40_000);
    expectNetIsSumOfAmounts(result);
  });

  it('до начислений — выручка и комиссия ожидаемые из заказа, с меткой', () => {
    const result = orderResultOf({
      marketplace: 'ozon',
      orderId: 'P-1',
      lines: [{ ...ozonLine, count: 2 }],
      operations: [ozonOp({ id: 'o2', article: 'delivery_to_buyer', amountKopecks: -7_600 })],
      costOf: COST_400,
    });
    expect(amount(result, 'revenue')).toMatchObject({
      kopecks: 100_000,
      source: 'expected',
      reason: 'no-operations',
    });
    expect(amount(result, 'commission')).toMatchObject({ kopecks: -30_000, source: 'expected' });
    expect(result.net.source).toBe('expected');
    expect(result.bySource.expected).toBe(70_000);
    expect(result.bySource.actual).toBe(-7_600 - 80_000);
    expectNetIsSumOfAmounts(result);
  });

  it('субсидия журнала ЯМ входит в выручку один раз, компенсация — отдельно', () => {
    const result = orderResultOf({
      marketplace: 'ym',
      orderId: '100',
      lines: [line({ buyerPriceKopecks: 80_000, marketplaceSubsidyKopecks: 20_000 })],
      operations: [
        op({ id: 's', article: 'sales', amountKopecks: 80_000 }),
        op({ id: 'sub', article: 'subsidies', amountKopecks: 20_000 }),
        op({ id: 'c', article: 'commission', amountKopecks: -10_000 }),
        op({ id: 'd', article: 'delivery_to_buyer', amountKopecks: -5_000 }),
        op({ id: 'k', article: 'compensations', amountKopecks: 3_000 }),
      ],
      costOf: COST_400,
    });
    expect(amount(result, 'revenue')).toMatchObject({
      kopecks: 100_000,
      operationIds: ['s', 'sub'],
    });
    expect(amount(result, 'compensations')).toMatchObject({ kopecks: 3_000, operationIds: ['k'] });
    expect(result.net.kopecks).toBe(100_000 - 10_000 - 5_000 + 3_000 - 40_000);
    expectNetIsSumOfAmounts(result);
  });
});

describe('приёмка №5 — корректировка через несколько дней пересчитывает результат', () => {
  it('новая операция корректировки меняет прибыль ровно на свою сумму', () => {
    const before = orderResultOf(ymOrder('Y5', 150_000, 12_000));
    const correction = op({
      id: 'Y5-fee-fix',
      orderId: 'Y5',
      article: 'commission',
      amountKopecks: 2_500,
      accruedAt: new Date('2026-10-09T09:00:00Z'),
      subArticle: 'commission_reversal',
    });
    const order = ymOrder('Y5', 150_000, 12_000);
    const after = orderResultOf({ ...order, operations: [...order.operations, correction] });

    expect(after.net.kopecks).toBe((before.net.kopecks as number) + 2_500);
    expect(amount(after, 'commission')).toMatchObject({
      kopecks: -9_500,
      operationIds: ['Y5-fee', 'Y5-fee-fix'],
    });
    expectNetIsSumOfAmounts(after);
  });

  it('ручная операция продавца ложится по своей статье', () => {
    const order = ymOrder('Y6', 150_000, 12_000);
    const manual = op({
      id: 'm1',
      orderId: 'Y6',
      article: 'penalties',
      amountKopecks: -1_000,
      origin: 'manual',
    });
    const result = orderResultOf({ ...order, operations: [...order.operations, manual] });
    expect(amount(result, 'other_services')).toMatchObject({
      kopecks: -1_000,
      operationIds: ['m1'],
    });
  });
});

describe('себестоимость v2 и момент продажи', () => {
  it('момент продажи — конец московского дня оформления, иначе дня выкупа', () => {
    expect(saleMomentOf({ createdOn: '2026-10-05', soldOn: '2026-10-07' })?.toISOString()).toBe(
      '2026-10-05T20:59:59.999Z',
    );
    expect(saleMomentOf({ createdOn: null, soldOn: '2026-10-07' })?.toISOString()).toBe(
      '2026-10-07T20:59:59.999Z',
    );
    expect(saleMomentOf({ createdOn: null, soldOn: null })).toBeNull();
  });

  it('закуп, загруженный позже в день оформления, действует; на следующий день — нет', () => {
    const order = ymOrder('C1', 200_000, 10_000);
    const sameDay = orderResultOf({
      ...order,
      costOf: costBy({ A1: [rec('2026-10-05T18:00:00+03:00', 500)] }),
    });
    expect(amount(sameDay, 'cogs')).toMatchObject({ kopecks: -50_000, source: 'actual' });

    const nextDay = orderResultOf({
      ...order,
      costOf: costBy({ A1: [rec('2026-10-06T00:00:00+03:00', 500)] }),
    });
    expect(amount(nextDay, 'cogs')).toMatchObject({
      kopecks: null,
      source: 'unknown',
      reason: 'no-record',
    });
    expect(nextDay.net).toEqual({
      kopecks: null,
      source: 'unknown',
      unknown: { key: 'cogs', reason: 'no-record' },
    });
  });

  it('товар не найден, нет дат — неизвестно с причиной, не 0', () => {
    const order = ymOrder('C2', 200_000, 10_000);
    expect(orderResultOf({ ...order, costOf: costBy({}) }).net.unknown).toEqual({
      key: 'cogs',
      reason: 'no-product',
    });
    const noDates = orderResultOf({
      ...order,
      lines: [line({ orderId: 'C2', createdOn: null, soldOn: null })],
    });
    expect(noDates.net.unknown).toEqual({ key: 'cogs', reason: 'no-sale-moment' });
  });

  it('вернувшаяся строка себестоимость не несёт, количество умножается', () => {
    const result = orderResultOf({
      marketplace: 'ym',
      orderId: '100',
      lines: [
        line({ itemId: '1', count: 3 }),
        line({ itemId: '2', count: 1, returnedOn: '2026-10-20', status: 'RETURNED' }),
      ],
      operations: [
        op({ id: 's', article: 'sales', amountKopecks: 400_000 }),
        op({ id: 'r', article: 'returns', amountKopecks: -100_000 }),
        op({ id: 'c', article: 'commission', amountKopecks: -20_000 }),
        op({ id: 'd', article: 'delivery_to_buyer', amountKopecks: -8_000 }),
        op({ id: 'rl', article: 'reverse_logistics', amountKopecks: -4_000 }),
      ],
      costOf: COST_400,
    });
    expect(amount(result, 'cogs')?.kopecks).toBe(-120_000);
    expect(amount(result, 'revenue')?.kopecks).toBe(300_000);
    expect(result.net.kopecks).toBe(300_000 - 20_000 - 8_000 - 4_000 - 120_000);
    expectNetIsSumOfAmounts(result);
  });
});

describe('распределённое и справочное', () => {
  it('распределённое — только переданное, с методикой и меткой allocated', () => {
    const order = ymOrder('A1', 200_000, 10_000);
    const plain = orderResultOf(order);
    expect(amount(plain, 'advertising_allocated')).toBeUndefined();
    expect(amount(plain, 'tax_allocated')).toBeUndefined();

    const result = orderResultOf({
      ...order,
      allocations: {
        advertising: { kopecks: -3_333, method: 'Пропорционально выручке' },
        tax: { kopecks: -12_000, method: 'УСН «Доходы» 6 %' },
      },
    });
    expect(amount(result, 'advertising_allocated')).toMatchObject({
      kopecks: -3_333,
      source: 'allocated',
      method: 'Пропорционально выручке',
      operationIds: [],
    });
    expect(result.net.source).toBe('allocated');
    expect(result.net.kopecks).toBe((plain.net.kopecks as number) - 3_333 - 12_000);
    expect(result.bySource.allocated).toBe(-15_333);
    expectNetIsSumOfAmounts(result);
  });

  it('оплачено баллами — справочно, вне суммы', () => {
    const order = ymOrder('B1', 200_000, 10_000);
    const result = orderResultOf({
      ...order,
      operations: [
        ...order.operations,
        op({ id: 'bonus', orderId: 'B1', article: 'bonus_payment', amountKopecks: -5_000 }),
      ],
    });
    expect(result.referenceOperationIds).toEqual(['bonus']);
    expect(result.net.kopecks).toBe(orderResultOf(order).net.kopecks);
  });

  it('без операций и строк — прибыли нет, не 0', () => {
    const result = orderResultOf({
      marketplace: 'ym',
      orderId: 'none',
      lines: [],
      operations: [],
      costOf: COST_400,
    });
    expect(result.net.kopecks).toBeNull();
    expect(result.net.unknown).toEqual({ key: 'revenue', reason: 'no-lines' });
    expect(result.prices.buyerKopecks).toBeNull();
  });
});

describe('режим Б — партии FIFO (TASK-215)', () => {
  const sold = (kopecks: number, returned: TLotSaleCost['returned'] = null): TLotSaleCost => ({
    status: 'known',
    kopecks,
    portions: [{ lotId: 'L1', receivedDay: '2026-10-01', units: 1, kopecks }],
    returned,
  });
  const base = ymOrder('100', 100_000, 20_000);

  it('себестоимость — из партий, метод lot_fifo; costOf не зовётся', () => {
    const costOf = vi.fn(COST_400);
    const result = orderResultOf({ ...base, costOf, lotCostOf: () => sold(150_000) });
    expect(amount(result, 'cogs')).toMatchObject({ kopecks: -150_000, source: 'actual' });
    expect(amount(result, 'cogs_write_off')).toBeUndefined();
    expect(result.costMethod).toBe('lot_fifo');
    expect(costOf).not.toHaveBeenCalled();
    expectNetIsSumOfAmounts(result);
  });

  it('режим А — метод historical_price', () => {
    expect(orderResultOf({ ...base, costOf: COST_400 }).costMethod).toBe('historical_price');
  });

  it('нет партии — «Неизвестная закупка», прибыль null, метод unknown', () => {
    const result = orderResultOf({
      ...base,
      costOf: COST_400,
      lotCostOf: () => ({ status: 'unknown', reason: 'no-lot', returned: null }),
    });
    expect(amount(result, 'cogs')).toMatchObject({ kopecks: null, reason: 'no-lot' });
    expect(result.net).toMatchObject({ kopecks: null, unknown: { key: 'cogs', reason: 'no-lot' } });
    expect(result.costMethod).toBe('unknown');
  });

  it('пригодный возврат — себестоимость 0, без списания; неизвестное состояние — с пометкой', () => {
    const lines = [line({ status: 'RETURNED', returnedOn: '2026-10-09' })];
    const fit = orderResultOf({
      ...base,
      lines,
      costOf: COST_400,
      lotCostOf: () => sold(150_000, { condition: 'fit', restored: true }),
    });
    expect(amount(fit, 'cogs')).toMatchObject({ kopecks: 0 });
    expect(amount(fit, 'cogs')?.note).toBeUndefined();
    expect(amount(fit, 'cogs_write_off')).toBeUndefined();

    const assumed = orderResultOf({
      ...base,
      lines,
      costOf: COST_400,
      lotCostOf: () => sold(150_000, { condition: 'unknown', restored: true }),
    });
    expect(amount(assumed, 'cogs')?.note).toBe(RETURN_ASSUMED_FIT_NOTE);
  });

  it('повреждённый возврат — строка «Списание возврата» в прибыли', () => {
    const result = orderResultOf({
      ...base,
      lines: [line({ status: 'RETURNED', returnedOn: '2026-10-09' })],
      costOf: COST_400,
      lotCostOf: () => sold(150_000, { condition: 'damaged', restored: false }),
    });
    expect(amount(result, 'cogs')).toMatchObject({ kopecks: 0 });
    expect(amount(result, 'cogs_write_off')).toMatchObject({
      title: 'Списание возврата',
      kopecks: -150_000,
      source: 'actual',
    });
    expectNetIsSumOfAmounts(result);
    expect(result.costMethod).toBe('lot_fifo');
  });
});
