import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type {
  IOrderProfit,
  IOrderProfitInput,
  TOrderForecastOf,
} from '../../src/modules/accounting/order-profit-state';
import type {
  IOrderResultOperation,
  TOrderCostOf,
  TOrderResultKey,
} from '../../src/modules/accounting/order-result';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AccountingOrderResultRepository } from '../../src/database/postgres/repositories/accounting-order-result.repository';
import {
  ORDER_FORECAST_BASIS,
  ORDER_PROFIT_STATE_TITLE,
  orderForecastRatesOf,
  orderProfitFingerprint,
  orderProfitStateOf,
  snapshotReasonOf,
} from '../../src/modules/accounting/order-profit-state';
import { orderResultOf } from '../../src/modules/accounting/order-result';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Состояние прибыли заказа «Финучёта» (TASK-218): forecast → preliminary →
 * reconciled, прогноз только `expected`, подтверждённое отдельно от ожидаемого,
 * версии снимков с причиной.
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
    count: 2,
    priceKopecks: 50_000,
    buyerPriceKopecks: 50_000,
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

/** Закуп 300 ₽ за штуку. */
const COST: TOrderCostOf = () => ({
  status: 'known',
  kopecks: 30_000,
  record: { validFrom: DAY, purchase: { price: 300, currency: 'RUR' }, source: 'price-list' },
});

/** Комиссия 20 %, логистика 150 ₽ за штуку. */
const FORECAST: TOrderForecastOf = () => ({
  commissionRate: 0.2,
  logisticsKopecks: 15_000,
  basis: ORDER_FORECAST_BASIS,
});

const SALE = op({
  id: 's1',
  article: 'sales',
  amountKopecks: 100_000,
  transactionType: 'Начисление',
});
const COMMISSION = op({ id: 'c1', article: 'commission', amountKopecks: -21_000 });
const DELIVERY = op({ id: 'd1', article: 'delivery_to_buyer', amountKopecks: -28_000 });

function profitOf(
  operations: IOrderResultOperation[],
  extra: Partial<IOrderProfitInput> = {},
  lines: IAccountingOrderLineInput[] = [line()],
): IOrderProfit {
  const result = orderResultOf({
    marketplace: 'ym',
    orderId: '100',
    lines,
    operations,
    costOf: COST,
  });
  return orderProfitStateOf({ result, lines, reconcile: null, forecastOf: FORECAST, ...extra });
}

const amountOf = (p: IOrderProfit, key: TOrderResultKey) => p.amounts.find((a) => a.key === key);

describe('orderProfitStateOf', () => {
  it('заказ без операций → forecast; комиссия и логистика — прогноз expected', () => {
    const p = profitOf([]);
    expect(p.state).toBe('forecast');
    expect(p.final).toBe(false);
    expect(amountOf(p, 'revenue')).toMatchObject({ kopecks: 100_000, source: 'expected' });
    expect(amountOf(p, 'commission')).toMatchObject({
      kopecks: -20_000,
      source: 'expected',
      reason: 'forecast',
      basis: ORDER_FORECAST_BASIS,
      title: 'Комиссия',
    });
    expect(amountOf(p, 'delivery')).toMatchObject({ kopecks: -30_000, source: 'expected' });
    // Подтверждено только закупом; всё прочее — ожидаемое.
    expect(p.confirmedKopecks).toBe(-60_000);
    expect(p.expectedKopecks).toBe(100_000 - 20_000 - 30_000);
    expect(p.netKopecks).toBe(-10_000);
    expect(p.unknown).toBeNull();
  });

  it('без прогноза — логистика неизвестна, прибыль null с причиной', () => {
    const p = profitOf([], { forecastOf: undefined });
    expect(p.state).toBe('forecast');
    expect(p.netKopecks).toBeNull();
    expect(p.unknown).toEqual({ key: 'commission', reason: 'no-operations' });
    expect(amountOf(p, 'delivery')).toMatchObject({ source: 'unknown', kopecks: null });
  });

  it('нет ставок у товара — прогноз не подставляется', () => {
    const p = profitOf([SALE, COMMISSION], { forecastOf: () => null });
    expect(amountOf(p, 'delivery')).toMatchObject({ source: 'unknown' });
    expect(p.netKopecks).toBeNull();
  });

  it('комиссия без логистики → preliminary, логистика expected и не в подтверждённом', () => {
    const p = profitOf([SALE, COMMISSION]);
    expect(p.state).toBe('preliminary');
    expect(amountOf(p, 'commission')).toMatchObject({ kopecks: -21_000, source: 'actual' });
    expect(amountOf(p, 'delivery')).toMatchObject({
      kopecks: -30_000,
      source: 'expected',
      reason: 'forecast',
    });
    expect(p.confirmedKopecks).toBe(100_000 - 21_000 - 60_000);
    expect(p.expectedKopecks).toBe(-30_000);
    expect(p.netKopecks).toBe(p.confirmedKopecks + p.expectedKopecks);
  });

  it('месяц сверен, но логистики нет — всё ещё preliminary', () => {
    const p = profitOf([SALE, COMMISSION], { reconcile: 'reconciled' });
    expect(p.state).toBe('preliminary');
    expect(p.final).toBe(false);
  });

  it('все суммы фактические, месяц не сверен → preliminary', () => {
    expect(profitOf([SALE, COMMISSION, DELIVERY]).state).toBe('preliminary');
  });

  it('месяц сверен и всё фактическое → reconciled, окончательная', () => {
    const p = profitOf([SALE, COMMISSION, DELIVERY], { reconcile: 'reconciled' });
    expect(p.state).toBe('reconciled');
    expect(p.final).toBe(true);
    expect(p.expectedKopecks).toBe(0);
    expect(p.netKopecks).toBe(100_000 - 21_000 - 28_000 - 60_000);
    expect(ORDER_PROFIT_STATE_TITLE[p.state]).toBe('Сверено');
  });

  it('сверка нашла расхождение по заказу → preliminary с пометкой', () => {
    const p = profitOf([SALE, COMMISSION, DELIVERY], { reconcile: 'discrepancy' });
    expect(p.state).toBe('preliminary');
    expect(p.reconcile).toBe('discrepancy');
  });

  it('ожидаемая комиссия из поля Ozon прогнозом не переписывается', () => {
    const lines = [line({ marketplace: 'ozon', commissionKopecks: 9_000 })];
    const result = orderResultOf({
      marketplace: 'ozon',
      orderId: '100',
      lines,
      operations: [],
      costOf: COST,
    });
    const p = orderProfitStateOf({ result, lines, reconcile: null, forecastOf: FORECAST });
    expect(amountOf(p, 'commission')).toMatchObject({
      kopecks: -18_000,
      source: 'expected',
      reason: 'no-operations',
    });
  });

  it('распределённое — в подтверждённом по методике, не в ожидаемом', () => {
    const result = orderResultOf({
      marketplace: 'ym',
      orderId: '100',
      lines: [line()],
      operations: [SALE, COMMISSION, DELIVERY],
      costOf: COST,
      allocations: { tax: { kopecks: -6_000, method: 'УСН 6 % от выручки' } },
    });
    const p = orderProfitStateOf({ result, lines: [line()], reconcile: 'reconciled' });
    expect(p.state).toBe('reconciled');
    expect(p.confirmedKopecks).toBe(100_000 - 21_000 - 28_000 - 60_000 - 6_000);
  });

  it('вернувшаяся позиция прогноза не несёт', () => {
    const lines = [line(), line({ itemId: '2', returnedOn: '2026-10-09' })];
    const p = profitOf([], {}, lines);
    expect(amountOf(p, 'delivery')).toMatchObject({ kopecks: -30_000 });
  });

  it('orderForecastRatesOf: ставки калькулятора → прогноз, без ставок — null', () => {
    expect(
      orderForecastRatesOf({
        rates: {
          commissionRate: 0.2,
          promotionRate: 0.05,
          logisticsKopecks: 15_000,
          otherKopecks: 0,
        },
      }),
    ).toEqual({ commissionRate: 0.2, logisticsKopecks: 15_000, basis: ORDER_FORECAST_BASIS });
    expect(orderForecastRatesOf({ rates: null })).toBeNull();
  });
});

describe('snapshotReasonOf', () => {
  it('все ветки', () => {
    expect(snapshotReasonOf(null, 'forecast')).toBe('first');
    expect(snapshotReasonOf(null, 'reconciled')).toBe('first');
    expect(snapshotReasonOf('forecast', 'preliminary')).toBe('recalculated');
    expect(snapshotReasonOf('preliminary', 'preliminary')).toBe('recalculated');
    expect(snapshotReasonOf('preliminary', 'reconciled')).toBe('reconciled');
    expect(snapshotReasonOf('reconciled', 'reconciled')).toBe('correction');
    expect(snapshotReasonOf('reconciled', 'preliminary')).toBe('correction');
  });

  it('отпечаток не зависит от порядка операций и меняется с суммой', () => {
    const a = profitOf([SALE, COMMISSION, DELIVERY]);
    const b = profitOf([DELIVERY, COMMISSION, SALE]);
    expect(orderProfitFingerprint(a)).toBe(orderProfitFingerprint(b));
    const c = profitOf([SALE, COMMISSION, { ...DELIVERY, amountKopecks: -29_000 }]);
    expect(orderProfitFingerprint(c)).not.toBe(orderProfitFingerprint(a));
  });
});

describe('снимки результата заказа в Postgres (PGlite)', () => {
  let fin: ITestFinanceDb;
  let repo: AccountingOrderResultRepository;
  const KEY = { marketplace: 'ym' as const, orderId: '100' };

  beforeAll(async () => {
    fin = await createTestFinanceDb();
    repo = new AccountingOrderResultRepository(fin.db);
  });
  afterEach(async () => fin.reset());
  afterAll(async () => fin.close());

  it('forecast → preliminary → reconciled → поздняя корректировка: новые версии, прежние целы', async () => {
    expect(await repo.recordSnapshot('u1', KEY, profitOf([]))).toEqual({
      version: 1,
      written: true,
      reason: 'first',
    });
    expect(await repo.recordSnapshot('u1', KEY, profitOf([]))).toEqual({
      version: 1,
      written: false,
      reason: null,
    });
    expect(await repo.recordSnapshot('u1', KEY, profitOf([SALE, COMMISSION]))).toMatchObject({
      version: 2,
      reason: 'recalculated',
    });
    const reconciled = profitOf([SALE, COMMISSION, DELIVERY], { reconcile: 'reconciled' });
    expect(await repo.recordSnapshot('u1', KEY, reconciled)).toMatchObject({
      version: 3,
      reason: 'reconciled',
    });
    // Поздняя корректировка логистики после сверки.
    const late = op({ id: 'd2', article: 'delivery_to_buyer', amountKopecks: -2_000 });
    const corrected = profitOf([SALE, COMMISSION, DELIVERY, late], { reconcile: 'reconciled' });
    expect(await repo.recordSnapshot('u1', KEY, corrected)).toMatchObject({
      version: 4,
      reason: 'correction',
    });

    const head = await repo.currentOf('u1', KEY);
    expect(head).toMatchObject({
      version: 4,
      state: 'reconciled',
      netKopecks: reconciled.netKopecks - 2_000,
      expectedKopecks: 0,
    });
    const versions = await repo.versionsOf('u1', KEY);
    expect(versions.map((row) => [row.version, row.state, row.reason])).toEqual([
      [1, 'forecast', 'first'],
      [2, 'preliminary', 'recalculated'],
      [3, 'reconciled', 'reconciled'],
      [4, 'reconciled', 'correction'],
    ]);
    // Сверенная версия 3 сохранилась с прежней суммой.
    expect(versions[2].value.netKopecks).toBe(reconciled.netKopecks);
    expect(versions[2].value.final).toBe(true);
  });

  it('продавцы и площадки изолированы', async () => {
    await repo.recordSnapshot('u1', KEY, profitOf([]));
    await repo.recordSnapshot('u2', KEY, profitOf([SALE, COMMISSION]));
    await repo.recordSnapshot('u1', { marketplace: 'ozon', orderId: '100' }, profitOf([SALE]));
    expect((await repo.versionsOf('u1', KEY)).map((row) => row.state)).toEqual(['forecast']);
    expect((await repo.versionsOf('u2', KEY)).map((row) => row.state)).toEqual(['preliminary']);
    expect(await repo.currentOf('u3', KEY)).toBeNull();
    expect(await repo.versionsOf('u3', KEY)).toEqual([]);
  });
});
