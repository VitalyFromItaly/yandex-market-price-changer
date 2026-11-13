import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IPnlOperation } from '../../src/modules/finance/pnl';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccountingCostSettingsRepository } from '../../src/database/postgres/repositories/accounting-cost-settings.repository';
import { AccountingLotRepository } from '../../src/database/postgres/repositories/accounting-lot.repository';
import { AccountingOrderLineRepository } from '../../src/database/postgres/repositories/accounting-order-line.repository';
import { AccountingCogsService } from '../../src/modules/accounting/accounting-cogs.service';
import {
  AccountingCostSettingsService,
  CostMethodValidationError,
} from '../../src/modules/accounting/accounting-cost-settings.service';
import { AccountingLotCostService } from '../../src/modules/accounting/accounting-lot-cost.service';
import { monthPeriod } from '../../src/modules/finance/finance-period';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { productsStub, purchasesServiceOf } from '../helpers/purchases-service';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Режим себестоимости и FIFO на PGlite (TASK-215): настройка продавца, общий
 * склад площадок, вычет налога в режиме Б — сумма партий, не прайс.
 */

const SELLER = '322';
const OCT = monthPeriod(2026, 10);
const LOTS_ON = { [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_LOTS]: true };

function line(partial: Partial<IAccountingOrderLineInput>): IAccountingOrderLineInput {
  return {
    marketplace: 'ym',
    orderId: '1',
    itemId: '1',
    campaignId: 'c1',
    offerId: 'A1',
    offerName: 'Часы',
    count: 1,
    priceKopecks: 1_000_000,
    buyerPriceKopecks: 1_000_000,
    buyerPriceBeforeDiscountKopecks: null,
    marketplaceSubsidyKopecks: 0,
    sellerDiscountKopecks: null,
    revenueKopecks: 1_000_000,
    payoutKopecks: null,
    commissionKopecks: null,
    status: 'DELIVERED',
    substatus: null,
    createdOn: '2026-10-02',
    soldOn: '2026-10-04',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  };
}

function op(partial: Partial<IPnlOperation>): IPnlOperation {
  return {
    id: 'op',
    article: 'sales',
    amountKopecks: 1_000_000,
    orderId: '1',
    sku: 'A1',
    serviceName: null,
    transactionType: 'Начисление',
    transactionSource: 'Платёж покупателя',
    accruedAt: new Date('2026-10-04T09:00:00Z'),
    paidAt: null,
    actDate: null,
    model: 'FBS',
    count: 1,
    marketplace: 'ym',
    ...partial,
  };
}

let pg: ITestFinanceDb;
let orderLines: AccountingOrderLineRepository;
let settings: AccountingCostSettingsService;
let cogs: AccountingCogsService;
let lotCost: AccountingLotCostService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  orderLines = new AccountingOrderLineRepository(pg.db);
  settings = new AccountingCostSettingsService(new AccountingCostSettingsRepository(pg.db));
  const products = {
    findByJournalSkus: async (_uid: string, _mp: string, skus: readonly string[]) =>
      new Map(skus.filter((sku) => sku === 'A1').map((sku) => [sku, { _id: 'product-a1' }])),
  } as never;
  cogs = new AccountingCogsService(
    orderLines,
    products,
    // Режим А в этих тестах не зовётся: закупа из прайса нет вовсе.
    { recordsOf: async () => new Map() } as never,
    { findByTelegramUser: async () => null } as never,
    settings,
    (lotCost = new AccountingLotCostService(
      new AccountingLotRepository(pg.db),
      orderLines,
      products,
    )),
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
  const purchases = purchasesServiceOf(pg.db, productsStub({ A1: 'product-a1' }));
  await purchases.createPurchase(SELLER, {
    supplier: 'ООО Восток',
    paidDay: '2026-10-01',
    amount: '1500',
    lines: [{ sku: 'A1', name: 'Часы', count: 1, price: 1500 }],
  });
  await purchases.createPurchase(SELLER, {
    supplier: 'ООО Восток',
    paidDay: '2026-10-01',
    amount: '3600',
    lines: [{ sku: 'A1', name: 'Часы', count: 2, price: 1800 }],
  });
});

describe('AccountingCostSettingsService', () => {
  it('по умолчанию А; выбор Б сохраняется; чужое значение — ошибка', async () => {
    expect(await settings.snapshot(SELLER)).toMatchObject({
      method: 'historical_price',
      isDefault: true,
    });
    await expect(settings.set(SELLER, 'average')).rejects.toBeInstanceOf(CostMethodValidationError);
    expect(await settings.set(SELLER, 'lot_fifo')).toMatchObject({
      method: 'lot_fifo',
      isDefault: false,
    });
    expect(await settings.methodOf(SELLER, LOTS_ON)).toBe('lot_fifo');
    // Фича партий закрыта — действует А.
    expect(await settings.methodOf(SELLER, {})).toBe('historical_price');
  });
});

describe('AccountingCogsService в режиме Б', () => {
  it('режим А — резолвера партий нет', async () => {
    expect(await cogs.lotCostOf(SELLER, LOTS_ON)).toBeUndefined();
  });

  it('склад общий: продажа Ozon после ЯМ берёт следующую партию', async () => {
    await settings.set(SELLER, 'lot_fifo');
    await orderLines.upsertLines(SELLER, [line({})]);
    await orderLines.upsertLines(SELLER, [
      line({ marketplace: 'ozon', orderId: 'OZ-1', campaignId: null, createdOn: '2026-10-03' }),
    ]);
    const lotCostOf = await cogs.lotCostOf(SELLER, LOTS_ON);
    const ym = lotCostOf?.(line({}));
    const ozon = lotCostOf?.(line({ marketplace: 'ozon', orderId: 'OZ-1' }));
    expect(ym).toMatchObject({ status: 'known', kopecks: 150_000 });
    expect(ozon).toMatchObject({ status: 'known', kopecks: 180_000 });
  });

  it('вычет налога — сумма партий; пригодный возврат уменьшает расход; без партии — неизвестно', async () => {
    await settings.set(SELLER, 'lot_fifo');
    await orderLines.upsertLines(SELLER, [
      line({ orderId: '1', count: 2 }),
      line({ orderId: '2', status: 'RETURNED', returnedOn: '2026-10-08' }),
      line({ orderId: '3', offerId: 'B2' }),
    ]);
    const lotCostOf = await cogs.lotCostOf(SELLER, LOTS_ON);
    const result = await cogs.cogsOf(
      SELLER,
      'ym',
      [
        op({ id: 's1', orderId: '1', count: 2 }),
        op({ id: 's2', orderId: '2' }),
        op({
          id: 'r2',
          orderId: '2',
          transactionType: 'Возврат',
          transactionSource: 'Возврат платежа покупателя',
          accruedAt: new Date('2026-10-08T09:00:00Z'),
        }),
        op({ id: 's3', orderId: '3', sku: 'B2' }),
      ],
      OCT,
      lotCostOf,
    );
    // Заказ 1: 1 500 + 1 800; заказ 2: 1 800, продан и возвращён — 0.
    expect(result.kopecks).toBe(330_000);
    expect(result.unknown).toEqual({ count: 1, operationIds: ['s3'] });
  });
});

describe('AccountingLotCostService.lotsWithRemaining (TASK-216)', () => {
  it('остаток — из FIFO по продажам всех площадок, а не из колонки remaining', async () => {
    await orderLines.upsertLines(SELLER, [line({})]);
    await orderLines.upsertLines(SELLER, [
      line({ marketplace: 'ozon', orderId: 'OZ-1', campaignId: null, createdOn: '2026-10-03' }),
    ]);
    const lots = await lotCost.lotsWithRemaining(SELLER);
    expect(lots.map((lot) => [lot.supplier, lot.count, lot.remaining])).toEqual([
      ['ООО Восток', 1, 0],
      ['ООО Восток', 2, 1],
    ]);
    // Колонка в базе не меняется — остаток считается на лету.
    const stored = await new AccountingLotRepository(pg.db).listForUser(SELLER);
    expect(stored.map((lot) => lot.remaining)).toEqual([1, 2]);
  });
});
