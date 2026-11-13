import type { TLotSaleCost } from '../../src/modules/accounting/accounting-lots.domain';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IOrderResultOperation } from '../../src/modules/accounting/order-result';
import type { IReturnResult, TReturnResultKey } from '../../src/modules/accounting/return-result';

import { describe, expect, it } from 'vitest';

import { RETURN_ASSUMED_FIT_NOTE } from '../../src/modules/accounting/order-result';
import {
  RETURN_RESULT_KEY_OF_ARTICLE,
  returnResultOf,
} from '../../src/modules/accounting/return-result';
import { FINANCE_ARTICLE_KEYS } from '../../src/modules/finance/finance-articles';

/**
 * Результат возвращённого заказа «Финучёта» (TASK-224, ТЗ п.3): приёмка №3,
 * восстановление пригодного возврата, списание повреждённого, комиссия
 * удержанная и возвращённая, только операции этого заказа.
 */

const DAY = new Date('2026-10-05T09:00:00Z');

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

function line(partial: Partial<IAccountingOrderLineInput> = {}): IAccountingOrderLineInput {
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
    status: 'RETURNED',
    substatus: null,
    createdOn: '2026-10-05',
    soldOn: '2026-10-07',
    deliveryOn: null,
    returnedOn: '2026-10-20',
    source: 'ym-orders',
    ...partial,
  };
}

const amountOf = (result: IReturnResult, key: TReturnResultKey) =>
  result.amounts.find((a) => a.key === key);

const sold = (kopecks: number, returned: TLotSaleCost['returned']): TLotSaleCost => ({
  status: 'known',
  kopecks,
  portions: [],
  returned,
});

/** Приёмка №3: доставка 150, обратная логистика 180, обработка возврата 50. */
const ACCEPTANCE_OPS = [
  op({ id: 'sale', article: 'sales', amountKopecks: 100_000 }),
  op({ id: 'refund', article: 'returns', amountKopecks: -100_000 }),
  op({ id: 'dlv', article: 'delivery_to_buyer', amountKopecks: -15_000 }),
  op({ id: 'rev', article: 'reverse_logistics', amountKopecks: -18_000 }),
  op({
    id: 'proc',
    article: 'processing',
    subArticle: 'return_processing',
    amountKopecks: -5_000,
  }),
];

const base = { marketplace: 'ym' as const, orderId: '100', lines: [line()] };

describe('returnResultOf', () => {
  it('приёмка №3: 150 + 180 + 50 = 380, позже компенсация 50 → 330', () => {
    const first = returnResultOf({ ...base, operations: ACCEPTANCE_OPS });
    expect(first.returned).toBe(true);
    expect(first.logisticsKopecks).toBe(-38_000);
    expect(first.resultKopecks).toBe(-38_000);
    expect(amountOf(first, 'return_processing')?.kopecks).toBe(-5_000);
    expect(amountOf(first, 'revenue')?.kopecks).toBe(0);

    const later = returnResultOf({
      ...base,
      operations: [
        ...ACCEPTANCE_OPS,
        op({ id: 'comp', article: 'compensations', amountKopecks: 5_000 }),
      ],
    });
    expect(later.logisticsKopecks).toBe(-38_000);
    expect(amountOf(later, 'compensations')?.kopecks).toBe(5_000);
    expect(later.resultKopecks).toBe(-33_000);
  });

  it('подстатья возврата важнее статьи: хранение возврата — своя строка, не прочие услуги', () => {
    const result = returnResultOf({
      ...base,
      operations: [
        op({ id: 's', article: 'storage', subArticle: 'return_storage', amountKopecks: -3_000 }),
        op({ id: 'p', article: 'penalties', subArticle: 'penalty', amountKopecks: -1_000 }),
      ],
    });
    expect(amountOf(result, 'return_storage')).toMatchObject({
      kopecks: -3_000,
      operationIds: ['s'],
    });
    expect(amountOf(result, 'other')).toMatchObject({ kopecks: -1_000, operationIds: ['p'] });
    expect(result.logisticsKopecks).toBe(-3_000);
  });

  it('комиссия и эквайринг: удержано, возвращено и невозвращённое нетто', () => {
    const result = returnResultOf({
      ...base,
      operations: [
        op({ id: 'c1', article: 'commission', amountKopecks: -12_000 }),
        op({ id: 'c2', article: 'commission', amountKopecks: 10_000 }),
        op({ id: 'a1', article: 'acquiring', amountKopecks: -1_500 }),
        op({ id: 'a2', article: 'acquiring', amountKopecks: 1_500 }),
      ],
    });
    expect(result.commission).toEqual({
      withheldKopecks: -12_000,
      returnedKopecks: 10_000,
      netKopecks: -2_000,
    });
    expect(result.acquiring.netKopecks).toBe(0);
    expect(result.resultKopecks).toBe(-2_000);
  });

  it('операции без номера заказа и чужого заказа не входят; баллы — справочно', () => {
    const result = returnResultOf({
      ...base,
      operations: [
        op({ id: 'mine', article: 'reverse_logistics', amountKopecks: -18_000 }),
        op({ id: 'shop', article: 'reverse_logistics', orderId: null, amountKopecks: -50_000 }),
        op({ id: 'other', article: 'reverse_logistics', orderId: '200', amountKopecks: -70_000 }),
        op({ id: 'pts', article: 'bonus_payment', amountKopecks: 4_000 }),
      ],
    });
    expect(amountOf(result, 'reverse_logistics')?.operationIds).toEqual(['mine']);
    expect(result.referenceOperationIds).toEqual(['pts']);
    expect(result.resultKopecks).toBe(-18_000);
  });

  it('режим А: возврат возвращается на склад — списания нет', () => {
    const result = returnResultOf({ ...base, operations: ACCEPTANCE_OPS });
    expect(amountOf(result, 'cogs_write_off')).toBeUndefined();
  });

  it('пригодный возврат восстанавливает партию: не потеря', () => {
    const result = returnResultOf({
      ...base,
      operations: ACCEPTANCE_OPS,
      lotCostOf: () => sold(60_000, { condition: 'fit', restored: true }),
    });
    expect(amountOf(result, 'cogs_write_off')).toBeUndefined();
    expect(result.resultKopecks).toBe(-38_000);
  });

  it('состояние неизвестно — принято пригодным, с пометкой', () => {
    const result = returnResultOf({
      ...base,
      operations: ACCEPTANCE_OPS,
      lotCostOf: () => sold(60_000, { condition: 'unknown', restored: true }),
    });
    expect(amountOf(result, 'cogs_write_off')).toMatchObject({
      kopecks: 0,
      note: RETURN_ASSUMED_FIT_NOTE,
    });
    expect(result.resultKopecks).toBe(-38_000);
  });

  it('повреждённый возврат — списание себестоимости в результат', () => {
    const result = returnResultOf({
      ...base,
      operations: ACCEPTANCE_OPS,
      lotCostOf: () => sold(60_000, { condition: 'damaged', restored: false }),
    });
    expect(amountOf(result, 'cogs_write_off')?.kopecks).toBe(-60_000);
    expect(result.resultKopecks).toBe(-98_000);
    expect(result.logisticsKopecks).toBe(-38_000);
  });

  it('неизвестная себестоимость списания — результат null с причиной, не 0', () => {
    const result = returnResultOf({
      ...base,
      operations: ACCEPTANCE_OPS,
      lotCostOf: () => ({
        status: 'unknown',
        reason: 'no-lot',
        returned: { condition: 'lost', restored: false },
      }),
    });
    expect(result.resultKopecks).toBeNull();
    expect(result.unknown).toEqual({ key: 'cogs_write_off', reason: 'no-lot' });
  });

  it('повторная упаковка — расход заказа целиком в результате', () => {
    const result = returnResultOf({
      ...base,
      operations: ACCEPTANCE_OPS,
      expenses: [{ id: 'e1', title: 'Упаковка', kopecks: -2_500, method: 'На заказ' }],
    });
    expect(amountOf(result, 'repacking')).toMatchObject({ kopecks: -2_500 });
    expect(amountOf(result, 'repacking')?.expenses).toHaveLength(1);
    expect(result.resultKopecks).toBe(-40_500);
  });

  it('у каждой статьи журнала есть место в результате', () => {
    for (const article of FINANCE_ARTICLE_KEYS) {
      expect(RETURN_RESULT_KEY_OF_ARTICLE[article]).toBeDefined();
    }
  });
});
