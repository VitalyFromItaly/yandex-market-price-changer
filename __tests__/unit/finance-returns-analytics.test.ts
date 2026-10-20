import type { IPnlOperation } from '../../src/modules/finance/pnl';

import { describe, expect, it } from 'vitest';

import {
  periodLinesOf,
  returnedOrderIdsOf,
  returnLossesOf,
  returnsAnalyticsOf,
} from '../../src/modules/finance/returns-analytics';

/**
 * «Аналитика возвратов» (TASK-145): правило потерь, штуки по движению товара,
 * невозвращённая комиссия нетто по заказу за любые даты.
 */

const SEPT = { from: '2026-09-01', to: '2026-09-30' };

let seq = 0;
const op = (over: Partial<IPnlOperation>): IPnlOperation => ({
  id: `op-${(seq += 1)}`,
  article: 'sales',
  amountKopecks: 0,
  orderId: null,
  sku: null,
  serviceName: null,
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  accruedAt: new Date('2026-09-10T09:00:00Z'),
  paidAt: null,
  actDate: null,
  count: null,
  marketplace: 'ym',
  ...over,
});

const sale = (orderId: string, sku: string, count: number, kopecks: number, at = '2026-09-05') =>
  op({
    orderId,
    sku,
    count: String(count),
    amountKopecks: kopecks,
    accruedAt: new Date(`${at}T09:00:00Z`),
  });
const refund = (orderId: string, sku: string, count: number, kopecks: number) =>
  op({
    article: 'returns',
    transactionType: 'Возврат',
    transactionSource: 'Возврат платежа покупателя',
    orderId,
    sku,
    count: String(count),
    amountKopecks: -kopecks,
  });
const pointsRefund = (orderId: string, sku: string, kopecks: number) =>
  op({
    article: 'returns',
    transactionType: 'Возврат',
    transactionSource: 'Возврат баллов за скидку Маркета',
    orderId,
    sku,
    count: '1',
    amountKopecks: -kopecks,
  });
const service = (
  article: IPnlOperation['article'],
  orderId: string | null,
  kopecks: number,
  at = '2026-09-10',
) =>
  op({
    article,
    transactionType: kopecks < 0 ? 'Удержание' : 'Начисление',
    transactionSource: 'Оплата услуг Маркета',
    orderId,
    amountKopecks: kopecks,
    accruedAt: new Date(`${at}T09:00:00Z`),
  });

describe('returnLossesOf', () => {
  it('потери = обратная логистика + удержания + невозвращённые комиссии − компенсации', () => {
    expect(
      returnLossesOf({
        reverseLogisticsKopecks: 30_000,
        withholdingsKopecks: 5_000,
        unreturnedCommissionKopecks: 12_000,
        compensationsKopecks: 7_000,
      }),
    ).toBe(30_000 + 5_000 + 12_000 - 7_000);
  });
});

describe('returnsAnalyticsOf', () => {
  function build(period: IPnlOperation[], orders: IPnlOperation[], products = new Map()) {
    const lines = periodLinesOf(period, SEPT);
    return returnsAnalyticsOf({
      marketplace: 'ym',
      period: SEPT,
      lines,
      orderOperations: orders,
      products,
    });
  }

  it('штуки — по движению товара: возврат баллов ЯМ — деньги без второй штуки', () => {
    const ops = [
      sale('1', 'A1', 2, 500_000),
      refund('1', 'A1', 1, 250_000),
      pointsRefund('1', 'A1', 10_000),
      sale('2', 'B2', 3, 300_000),
    ];
    const view = build(ops, []);
    expect(view.totals.returnedUnits).toBe(1);
    expect(view.totals.returnedOrders).toBe(1);
    expect(view.totals.soldUnits).toBe(5);
    expect(view.totals.returnRate).toBeCloseTo(1 / 5);
    expect(view.totals.returnedAmountKopecks).toBe(260_000);
    // B2 без возвратов в список товаров не попадает, но выкупы его в итоге есть.
    expect(view.skus.map((s) => s.sku)).toEqual(['A1']);
    expect(view.skus[0].returnRate).toBeCloseTo(1 / 2);
  });

  it('невозвращённая комиссия — нетто по заказу за любые даты, на товар строки возврата', () => {
    // Продажа и комиссия — в августе, возврат и возврат части комиссии — в сентябре.
    const augSale = sale('7', 'A1', 1, 400_000, '2026-08-20');
    const augCommission = service('commission', '7', -40_000, '2026-08-20');
    const septRefund = refund('7', 'A1', 1, 400_000);
    const septCommissionBack = service('commission', '7', 15_000);
    const period = [augSale, augCommission, septRefund, septCommissionBack];
    const lines = periodLinesOf(period, SEPT);
    expect(lines.map((l) => l.id)).toEqual([septRefund.id, septCommissionBack.id]);
    expect(returnedOrderIdsOf(lines)).toEqual(['7']);

    const view = build(period, [augSale, augCommission, septRefund, septCommissionBack]);
    expect(view.totals.unreturnedCommissionKopecks).toBe(40_000 - 15_000);
    expect(view.skus[0].unreturnedCommissionKopecks).toBe(25_000);
    // Выкупа в периоде нет — процента нет, а не бесконечность.
    expect(view.totals.soldUnits).toBe(0);
    expect(view.totals.returnRate).toBeNull();
  });

  it('расходы и компенсации — в потерях; строки без артикула — в «не отнесено», Σ сходится', () => {
    const ops = [
      sale('1', 'A1', 1, 100_000),
      refund('1', 'A1', 1, 100_000),
      { ...service('reverse_logistics', '1', -20_000), sku: 'A1' },
      service('reverse_logistics', null, -5_000),
      service('withholdings', null, -3_000),
      service('compensations', null, 4_000),
      sale('2', 'B2', 1, 100_000),
      refund('2', 'B2', 1, 100_000),
    ];
    const commission = [
      service('commission', '1', -10_000, '2026-09-05'),
      service('commission', '2', -8_000, '2026-09-05'),
    ];
    const products = new Map([
      ['A1', { name: 'Casio G-Shock' }],
      ['B2', { name: 'Амфибия 420' }],
    ]);
    const view = build(ops, commission, products);

    expect(view.totals).toMatchObject({
      reverseLogisticsKopecks: 25_000,
      withholdingsKopecks: 3_000,
      compensationsKopecks: 4_000,
      unreturnedCommissionKopecks: 18_000,
      lossesKopecks: 25_000 + 3_000 + 18_000 - 4_000,
    });
    expect(view.rest.lossesKopecks).toBe(5_000 + 3_000 - 4_000);
    const sum = (pick: (row: { lossesKopecks: number }) => number, rows: { lossesKopecks: number }[]) =>
      rows.reduce((total, row) => total + pick(row), 0);
    expect(sum((r) => r.lossesKopecks, view.skus) + view.rest.lossesKopecks).toBe(
      view.totals.lossesKopecks,
    );
    expect(sum((r) => r.lossesKopecks, view.brands) + view.rest.lossesKopecks).toBe(
      view.totals.lossesKopecks,
    );
    expect(view.brands.map((b) => [b.key, b.skus])).toEqual([
      ['vostok', 1],
      ['casio', 1],
    ]);
    // По потерям по убыванию: A1 — 20 000 логистики + 10 000 комиссии.
    expect(view.skus.map((s) => s.sku)).toEqual(['A1', 'B2']);
  });

  it('строки, оплаченные в периоде, но начисленные раньше, не считаются', () => {
    const late = { ...refund('9', 'A1', 1, 50_000), accruedAt: new Date('2026-08-31T09:00:00Z') };
    expect(build([late], []).totals.returnedUnits).toBe(0);
  });
});
