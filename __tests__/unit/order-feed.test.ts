import type { IMarketplaceOrder } from '../../src/modules/marketplaces/marketplace-adapter';
import type { IPnlOperation } from '../../src/modules/finance/pnl';

import { describe, expect, it } from 'vitest';

import { orderFeedOf, orderProfitOf } from '../../src/modules/finance/order-feed';

const DAY = new Date('2026-10-05T09:00:00Z');

function op(partial: Partial<IPnlOperation>): IPnlOperation {
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
    ...partial,
  };
}

const SALE = op({
  id: 'sale',
  article: 'sales',
  amountKopecks: 300_000,
  sku: 'A1',
  count: '2',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
});
const COMMISSION = op({ id: 'fee', article: 'commission', amountKopecks: -30_000 });
const DELIVERY = op({ id: 'dlv', article: 'delivery_to_buyer', amountKopecks: -15_000 });
const BONUS = op({ id: 'bonus', article: 'bonus_payment', amountKopecks: 5_000 });

/** Закуп A1 — 1000 ₽ штука в любой день; остальное неизвестно. */
const costOf = (sku: string) => (sku === 'A1' ? 100_000 : undefined);

function order(id: string, partial: Partial<IMarketplaceOrder> = {}): IMarketplaceOrder {
  return {
    marketplace: 'ym',
    id,
    orderNumber: id,
    scheme: 'FBS',
    stage: 'redeemed',
    status: 'DELIVERED',
    substatus: null,
    createdDay: '2026-10-01',
    items: [{ sku: 'A1', count: 2, price: 1500 }],
    sales: 3000,
    ...partial,
  };
}

describe('прибыль заказа = Σ операций − себестоимость (TASK-144)', () => {
  it('операции по статьям, справочные баллы вне суммы, закуп по строке продажи', () => {
    const profit = orderProfitOf([SALE, COMMISSION, DELIVERY, BONUS], costOf);
    expect(profit.operations).toBe(4);
    expect(profit.operationsKopecks).toBe(300_000 - 30_000 - 15_000);
    expect(profit.cogsKopecks).toBe(200_000);
    expect(profit.profitKopecks).toBe(55_000);
    expect(profit.profitGap).toBeNull();
    expect(profit.articles.map((a) => [a.article, a.kopecks, a.group])).toEqual([
      ['sales', 300_000, 'income'],
      ['commission', -30_000, 'expense'],
      ['delivery_to_buyer', -15_000, 'expense'],
      ['bonus_payment', 5_000, 'reference'],
    ]);
  });

  it('возврат товара уменьшает себестоимость', () => {
    const back = op({
      id: 'ret',
      article: 'returns',
      amountKopecks: -150_000,
      sku: 'A1',
      count: '1',
      transactionType: 'Возврат',
      transactionSource: 'Возврат платежа покупателя',
    });
    const profit = orderProfitOf([SALE, back], costOf);
    expect(profit.cogsKopecks).toBe(100_000);
    expect(profit.profitKopecks).toBe(150_000 - 100_000);
  });

  it('части одной операции (breakdown) — одна операция, Σ по статьям', () => {
    const parts = [
      op({ id: 'x', article: 'commission', amountKopecks: -1_000 }),
      op({ id: 'x', article: 'acquiring', amountKopecks: -200 }),
    ];
    const profit = orderProfitOf(parts, costOf);
    expect(profit.operations).toBe(1);
    expect(profit.operationsKopecks).toBe(-1_200);
    expect(profit.profitKopecks).toBe(-1_200);
  });

  it('операций нет — прибыль null, не 0', () => {
    const profit = orderProfitOf([], costOf);
    expect(profit).toMatchObject({
      operations: 0,
      operationsKopecks: null,
      cogsKopecks: null,
      profitKopecks: null,
      profitGap: 'no-operations',
    });
  });

  it('закупа нет — прибыль null с причиной, сумма операций видна', () => {
    const profit = orderProfitOf([{ ...SALE, sku: 'Z9' }, COMMISSION], costOf);
    expect(profit.operationsKopecks).toBe(270_000);
    expect(profit.cogsKopecks).toBeNull();
    expect(profit.profitKopecks).toBeNull();
    expect(profit.profitGap).toBe('no-cost');
  });

  it('лента: операции к заказу по номеру, итоги площадки — только посчитанные', () => {
    const feed = orderFeedOf(
      'ym',
      [order('100'), order('200', { createdDay: '2026-10-03', stage: 'in_transit' })],
      [SALE, COMMISSION, op({ id: 'alien', orderId: '999', amountKopecks: -1 })],
      costOf,
    );
    expect(feed.rows.map((row) => [row.order.id, row.stageLabel, row.profitKopecks])).toEqual([
      ['200', 'В пути', null],
      ['100', 'Выкуплен', 300_000 - 30_000 - 200_000],
    ]);
    expect(feed.totals).toEqual({
      marketplace: 'ym',
      orders: 2,
      withOperations: 1,
      profitKopecks: 70_000,
      profitOrders: 1,
    });
  });
});
