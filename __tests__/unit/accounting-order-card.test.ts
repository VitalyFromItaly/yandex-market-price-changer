import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { TOrderUnitCost } from '../../src/modules/accounting/order-result';
import type { ICrmJobContext } from '../../src/modules/crm/jobs/crm-jobs.domain';

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingAllocationSettingsRepository } from '../../src/database/postgres/repositories/accounting-allocation-settings.repository';
import { AccountingCostSettingsRepository } from '../../src/database/postgres/repositories/accounting-cost-settings.repository';
import { AccountingLotRepository } from '../../src/database/postgres/repositories/accounting-lot.repository';
import { AccountingManualOperationRepository } from '../../src/database/postgres/repositories/accounting-manual-operation.repository';
import { AccountingOrderLineRepository } from '../../src/database/postgres/repositories/accounting-order-line.repository';
import { AccountingOrderResultRepository } from '../../src/database/postgres/repositories/accounting-order-result.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { AccountingAllocationSettingsService } from '../../src/modules/accounting/accounting-allocation-settings.service';
import { AccountingCogsService } from '../../src/modules/accounting/accounting-cogs.service';
import { AccountingCostSettingsService } from '../../src/modules/accounting/accounting-cost-settings.service';
import { AccountingLotCostService } from '../../src/modules/accounting/accounting-lot-cost.service';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import { AccountingStoreCostsService } from '../../src/modules/accounting/accounting-store-costs.service';
import {
  AccountingOrderCardService,
  AccountingOrderNotFoundError,
} from '../../src/modules/accounting/accounting-order-card.service';
import {
  ACCOUNTING_ORDERS_KIND,
  ACCOUNTING_ORDER_KIND,
  parseAccountingOrderParams,
  parseAccountingOrdersFilter,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import {
  ACCOUNTING_ORDER_FEATURES,
  CrmAccountingKinds,
} from '../../src/modules/crm/accounting/crm-accounting.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { productsStub, purchasesServiceOf } from '../helpers/purchases-service';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Карточка и список заказов «Финучёта» (TASK-222) на PGlite: строки заказов,
 * журнал ЯМ и ручные операции — настоящие; налог, закуп, прогноз и сверка —
 * заглушки (у них свои тесты). Числа — из ядра TASK-217/218/219.
 */

const SELLER = '322';
const SEPT = monthPeriod(2026, 9);
const NOW = new Date('2026-10-15T09:00:00Z');
const CAMPAIGN_ID = 'ym-campaign-secret';
const STORE = { campaign_id: CAMPAIGN_ID } as never;
const ACTOR = { author: SELLER, impersonatedBy: null };

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 1,
  transactionSum: 10000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '20.09.2026',
  bankSum: 7700,
  model: 'FBS',
  ...over,
});

const commission = row({
  shopSku: null,
  transactionType: 'Удержание',
  transactionSource: 'Оплата услуг Маркета',
  offerOrServiceName: 'Размещение товарных предложений',
  transactionSum: -2300,
  count: null,
  actDate: '30.09.2026',
});

function line(partial: Partial<IAccountingOrderLineInput> = {}): IAccountingOrderLineInput {
  return {
    marketplace: 'ym',
    orderId: '1',
    itemId: '1',
    campaignId: CAMPAIGN_ID,
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
    createdOn: '2026-09-16',
    soldOn: '2026-09-18',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  };
}

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let orderLines: AccountingOrderLineRepository;
let manual: AccountingManualOperationsService;
let allocation: AccountingAllocationSettingsService;
let service: AccountingOrderCardService;
let costSettings: AccountingCostSettingsService;
let documentId: string;

const marketplacesOf = vi.fn(async () => ['ym']);
const orderTaxItem = vi.fn(async () => ({
  id: 'tax:2026-09-01:2026-09-30',
  kind: 'tax' as const,
  kopecks: -60_000,
  title: 'Налог периода',
  accruedOn: '2026-09-30',
  source: 'tax' as const,
}));
const unitCostResolver = vi.fn(
  async () =>
    (sku: string): TOrderUnitCost =>
      sku === 'A1'
        ? {
            status: 'known',
            kopecks: 300_000,
            record: {
              validFrom: new Date('2026-09-01T00:00:00Z'),
              purchase: { price: 3000, currency: 'RUR' },
              source: 'price-list',
            },
          }
        : { status: 'unknown', reason: 'no-product' },
);
const reconcile = vi.fn(async () => ({ status: 'insufficient_data', discrepantOrderIds: [] }));
const build = vi.fn(async () => ({
  account: null,
  skus: [
    {
      sku: 'B2',
      rates: { commissionRate: 0.1, promotionRate: 0, logisticsKopecks: 5_000, otherKopecks: 0 },
    },
  ],
}));

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  orderLines = new AccountingOrderLineRepository(pg.db);
  manual = new AccountingManualOperationsService(new AccountingManualOperationRepository(pg.db));
  allocation = new AccountingAllocationSettingsService(
    new AccountingAllocationSettingsRepository(pg.db),
  );
  costSettings = new AccountingCostSettingsService(new AccountingCostSettingsRepository(pg.db));
  // Режим Б — настоящий выбор режима и FIFO; товар продажи — A1 → product-a1.
  const saleProducts = {
    findByJournalSkus: async (_uid: string, _mp: string, skus: readonly string[]) =>
      new Map(skus.filter((sku) => sku === 'A1').map((sku) => [sku, { _id: 'product-a1' }])),
  } as never;
  const realCogs = new AccountingCogsService(
    orderLines,
    saleProducts,
    {} as never,
    {} as never,
    costSettings,
    new AccountingLotCostService(new AccountingLotRepository(pg.db), orderLines, saleProducts),
  );
  service = new AccountingOrderCardService(
    { marketplacesOf } as never,
    orderLines,
    operations,
    manual,
    new AccountingStoreCostsService(
      allocation,
      new FinanceExpensesService(new FinanceExpenseRepository(pg.db)),
    ),
    { orderTaxItem } as never,
    {
      unitCostResolver,
      lotCostOf: (uid: string, features: Record<string, boolean>) =>
        realCogs.lotCostOf(uid, features),
    } as never,
    { reconcile } as never,
    { build } as never,
    new AccountingOrderResultRepository(pg.db),
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
  for (const fn of [marketplacesOf, orderTaxItem, unitCostResolver, reconcile, build]) {
    fn.mockClear();
  }

  const rows = [row(), commission];
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    buffer: Buffer.from(JSON.stringify(rows)),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  documentId = document.id;
  const keys = journalKeys(rows);
  await operations.upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: financePeriodKey('united-netting', SEPT),
      }),
    ),
  );

  await orderLines.upsertLines(SELLER, [
    line(),
    // Другой магазин того же кабинета: в базу распределения входит, в выдачу — нет.
    line({ orderId: '2', campaignId: 'c2' }),
    // Без операций, закуп неизвестен.
    line({ orderId: '3', offerId: 'B2', offerName: 'Ремешок', revenueKopecks: 500_000 }),
  ]);

  await manual.create(
    SELLER,
    {
      clientKey: randomUUID(),
      marketplace: 'ym',
      article: 'delivery_to_buyer',
      amount: '-100',
      accruedOn: '2026-09-17',
      orderId: '1',
      source: 'Акт',
      documentNumber: 'Д-1',
    },
    ACTOR,
  );
  await manual.create(
    SELLER,
    {
      clientKey: randomUUID(),
      marketplace: 'ym',
      article: 'promotion',
      amount: '-3000',
      accruedOn: '2026-09-20',
      source: 'Кампания',
    },
    ACTOR,
  );
}, 60_000);

describe('AccountingOrderCardService.order', () => {
  it('каждая сумма — источник и операции с документом; распределённое — с методикой', async () => {
    const card = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    const of = (key: string) => card.amounts.find((a) => a.key === key);

    expect(of('revenue')).toMatchObject({ kopecks: 1_000_000, source: 'actual' });
    expect(of('revenue')?.operations).toEqual([
      expect.objectContaining({
        kopecks: 1_000_000,
        accruedOn: '2026-09-16',
        marketplace: 'ym',
        documentId,
        origin: 'journal',
      }),
    ]);
    expect(of('commission')).toMatchObject({ kopecks: -230_000, source: 'actual' });
    expect(of('delivery')?.operations).toEqual([
      expect.objectContaining({ kopecks: -10_000, documentId: 'Д-1', origin: 'manual' }),
    ]);
    // Σ частей раскрытия = сумма строки.
    for (const amount of card.amounts.filter((a) => a.operations.length)) {
      expect(amount.operations.reduce((s, o) => s + o.kopecks, 0)).toBe(amount.kopecks);
    }
    expect(of('cogs')).toMatchObject({ kopecks: -300_000, source: 'actual' });
    expect(of('cogs')?.costLines).toEqual([
      expect.objectContaining({ offerId: 'A1', count: 1, unitKopecks: 300_000, reason: null }),
    ]);

    // База — заказы 1, 2, 3 по выручке 10 000 / 10 000 / 5 000 ₽ (заказ 2 — другого магазина).
    expect(of('advertising_allocated')).toMatchObject({
      kopecks: -120_000,
      source: 'allocated',
      method: 'Пропорционально выручке',
      allocationPeriod: SEPT,
    });
    expect(of('tax_allocated')).toMatchObject({
      kopecks: -24_000,
      note: 'Оценка, не обязательство',
    });

    expect(card).toMatchObject({
      state: 'preliminary',
      reconcile: 'unknown',
      costMethod: 'Пропорционально выручке',
      netKopecks: 1_000_000 - 230_000 - 10_000 - 300_000 - 120_000 - 24_000,
      snapshot: { version: 1, written: true, reason: 'first' },
    });
    expect(card.versions).toHaveLength(1);
    expect(JSON.stringify(card)).not.toContain(CAMPAIGN_ID);

    const again = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    expect(again.snapshot).toEqual({ version: 1, written: false, reason: null });
  });

  it('заказ другого магазина или без строк — не найден', async () => {
    await expect(
      service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '2' }, NOW),
    ).rejects.toBeInstanceOf(AccountingOrderNotFoundError);
    await expect(
      service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '404' }, NOW),
    ).rejects.toBeInstanceOf(AccountingOrderNotFoundError);
    await expect(
      service.order(SELLER, {}, STORE, { marketplace: 'ozon', orderId: '1' }, NOW),
    ).rejects.toBeInstanceOf(AccountingOrderNotFoundError);
  });

  it('без операций — прогноз со ставками калькулятора; неизвестный закуп — прибыль null', async () => {
    const card = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '3' }, NOW);
    expect(card.state).toBe('forecast');
    expect(card.amounts.find((a) => a.key === 'commission')).toMatchObject({
      kopecks: -50_000,
      source: 'expected',
      reason: 'forecast',
      basis: expect.any(String),
    });
    expect(card.netKopecks).toBeNull();
    expect(card.unknown).toEqual({ key: 'cogs', reason: 'no-product' });
  });
});

describe('AccountingOrderCardService — режим Б (TASK-215)', () => {
  const LOTS_ON = { [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_LOTS]: true };

  beforeEach(async () => {
    const purchases = purchasesServiceOf(pg.db, productsStub({ A1: 'product-a1' }));
    await purchases.createPurchase(SELLER, {
      supplier: 'ООО Восток',
      paidDay: '2026-09-01',
      amount: '1500',
      lines: [{ sku: 'A1', name: 'Часы', count: 1, price: 1500 }],
    });
    await purchases.createPurchase(SELLER, {
      supplier: 'ООО Восток',
      paidDay: '2026-09-10',
      amount: '1800',
      lines: [{ sku: 'A1', name: 'Часы', count: 1, price: 1800 }],
    });
    await costSettings.set(SELLER, 'lot_fifo');
  });

  it('себестоимость — из самой ранней партии, у карточки и списка метод lot_fifo', async () => {
    const card = await service.order(
      SELLER,
      LOTS_ON,
      STORE,
      { marketplace: 'ym', orderId: '1' },
      NOW,
    );
    const cogs = card.amounts.find((a) => a.key === 'cogs');
    // Заказы 1 и 2 (A1) в один день: 1 берёт партию 1 500 ₽, 2 — 1 800 ₽.
    expect(cogs).toMatchObject({ kopecks: -150_000, source: 'actual' });
    expect(cogs?.costLines).toEqual([
      expect.objectContaining({
        offerId: 'A1',
        unitKopecks: 150_000,
        totalKopecks: 150_000,
        portions: [{ receivedDay: '2026-09-01', units: 1, kopecks: 150_000 }],
        reason: null,
      }),
    ]);
    expect(card).toMatchObject({
      cogsMethod: 'lot_fifo',
      cogsMethodTitle: 'Партии закупок (FIFO)',
    });
    expect(unitCostResolver).not.toHaveBeenCalledWith(SELLER, 'ym', ['A1']);

    const list = await service.orders(SELLER, LOTS_ON, STORE, SEPT, {}, NOW);
    expect(list.cogsMethod).toBe('lot_fifo');
  });

  it('товар без партии — «Неизвестная закупка», без отката на прайс', async () => {
    const card = await service.order(
      SELLER,
      LOTS_ON,
      STORE,
      { marketplace: 'ym', orderId: '3' },
      NOW,
    );
    expect(card.amounts.find((a) => a.key === 'cogs')).toMatchObject({
      kopecks: null,
      reason: 'no-product',
    });
    expect(card).toMatchObject({ cogsMethod: 'unknown', netKopecks: null });
  });

  it('фича партий закрыта — действует режим А', async () => {
    const card = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    expect(card.amounts.find((a) => a.key === 'cogs')).toMatchObject({ kopecks: -300_000 });
    expect(card.cogsMethod).toBe('historical_price');
  });
});

describe('AccountingOrderCardService — сверка по площадке (TASK-236)', () => {
  const insufficient = { status: 'insufficient_data', discrepantOrderIds: [] as string[] };
  const ozonReconcile = (discrepantOrderIds: string[]) =>
    reconcile.mockImplementation((async (...args: unknown[]) =>
      args[3] === 'ozon'
        ? { status: 'reconciled', discrepantOrderIds }
        : insufficient) as unknown as () => Promise<typeof insufficient>);

  beforeEach(async () => {
    marketplacesOf.mockImplementation(async () => ['ym', 'ozon', 'wb']);
    await orderLines.upsertLines(SELLER, [
      line({ marketplace: 'ozon', orderId: 'O1', campaignId: null, source: 'ozon-postings' }),
      line({ marketplace: 'wb', orderId: 'W1', campaignId: null, source: 'wb-statistics' }),
    ]);
  });

  afterEach(() => {
    marketplacesOf.mockImplementation(async () => ['ym']);
    reconcile.mockImplementation(async () => insufficient);
  });

  it('Ozon — orderReconcileStateOf сверки v2 месяца Ozon', async () => {
    ozonReconcile(['O1']);
    const discrepant = await service.order(
      SELLER,
      {},
      STORE,
      { marketplace: 'ozon', orderId: 'O1' },
      NOW,
    );
    expect(discrepant.reconcile).toBe('discrepancy');
    expect(reconcile).toHaveBeenCalledWith(SELLER, SEPT, NOW, 'ozon');

    ozonReconcile([]);
    const reconciled = await service.order(
      SELLER,
      {},
      STORE,
      { marketplace: 'ozon', orderId: 'O1' },
      NOW,
    );
    expect(reconciled.reconcile).toBe('reconciled');

    reconcile.mockImplementation(async () => insufficient);
    const unknown = await service.order(
      SELLER,
      {},
      STORE,
      { marketplace: 'ozon', orderId: 'O1' },
      NOW,
    );
    expect(unknown.reconcile).toBe('unknown');
  });

  it('WB — unknown без вызова сверки', async () => {
    ozonReconcile([]);
    const card = await service.order(SELLER, {}, STORE, { marketplace: 'wb', orderId: 'W1' }, NOW);
    expect(card.reconcile).toBe('unknown');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('список всех площадок — сверка один раз на ЯМ и Ozon, у WB — нет', async () => {
    ozonReconcile(['O1']);
    const list = await service.orders(SELLER, {}, STORE, SEPT, {}, NOW);
    expect(list.rows.map((r) => r.orderId)).toEqual(expect.arrayContaining(['1', 'O1', 'W1']));
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls.map((c: unknown[]) => c[3])).toEqual(
      expect.arrayContaining(['ym', 'ozon']),
    );
  });
});

describe('AccountingOrderCardService.orders', () => {
  it('месяц магазина: фильтры состояния и убыточных, итоги', async () => {
    const list = await service.orders(SELLER, {}, STORE, SEPT, {}, NOW);
    expect(list.rows.map((r) => r.orderId)).toEqual(['3', '1']);
    expect(list.totals).toMatchObject({ count: 2, lossCount: 0, unknownCount: 1 });
    expect(list.unallocatedKopecks).toBe(0);
    // Прогноз и сверка ЯМ — один раз на задачу, не на заказ.
    expect(build).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);

    const forecast = await service.orders(SELLER, {}, STORE, SEPT, { state: 'forecast' }, NOW);
    expect(forecast.rows.map((r) => r.orderId)).toEqual(['3']);
    const losses = await service.orders(SELLER, {}, STORE, SEPT, { lossOnly: true }, NOW);
    expect(losses.rows).toEqual([]);
    const ozon = await service.orders(SELLER, {}, STORE, SEPT, { marketplace: 'ozon' }, NOW);
    expect(ozon.rows).toEqual([]);
  });

  it('методика «не распределять» — общие расходы месяца в нераспределённом', async () => {
    await allocation.set(SELLER, 'none');
    const list = await service.orders(SELLER, {}, STORE, SEPT, {}, NOW);
    expect(list.costMethod).toBe('Не распределять');
    expect(list.unallocatedKopecks).toBe(-300_000 - 60_000);
    const card = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    expect(card.amounts.some((a) => a.source === 'allocated')).toBe(false);
  });
});

describe('AccountingOrderCardService — расходы продавца (TASK-220)', () => {
  let expenses: FinanceExpensesService;
  beforeAll(() => {
    expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  });
  const oneOff = (over: Record<string, unknown>) => ({
    kind: 'one_off',
    fromDay: '2026-09-10',
    ...over,
  });

  it('расход заказа — «Прочие расходы» этого заказа, товара — по штукам артикула', async () => {
    await expenses.create(
      SELLER,
      oneOff({
        category: 'packaging',
        amount: 500,
        scope: 'order',
        marketplace: 'ym',
        orderId: '1',
      }),
    );
    await expenses.create(
      SELLER,
      oneOff({ category: 'packaging', amount: 300, scope: 'product', sku: 'B2' }),
    );
    // Заказ другого месяца — в сентябре не считается вовсе.
    await expenses.create(
      SELLER,
      oneOff({
        category: 'packaging',
        amount: 70,
        scope: 'order',
        marketplace: 'ym',
        orderId: '99',
      }),
    );

    const card = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    const other = card.amounts.find((a) => a.key === 'other_expenses');
    expect(other).toMatchObject({
      title: 'Прочие расходы',
      kopecks: -50_000,
      source: 'allocated',
      method: 'Расход заказа',
    });
    expect(other?.expenses).toEqual([
      expect.objectContaining({ title: 'Упаковка', kopecks: -50_000 }),
    ]);

    const ribbon = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '3' }, NOW);
    expect(ribbon.amounts.find((a) => a.key === 'other_expenses')).toMatchObject({
      kopecks: -30_000,
      method: 'По штукам товара',
    });
    const list = await service.orders(SELLER, {}, STORE, SEPT, {}, NOW);
    expect(list.unallocatedKopecks).toBe(0);
  });

  it('бизнес и площадка — общие расходы по методике, суммой в одной строке', async () => {
    // База — заказы 1, 2, 3 по выручке 10 000 / 10 000 / 5 000 ₽: доля заказа 1 — 2/5.
    await expenses.create(SELLER, oneOff({ category: 'rent', amount: 2500 }));
    await expenses.create(
      SELLER,
      oneOff({ category: 'website', amount: 500, scope: 'marketplace', marketplace: 'ym' }),
    );
    const card = await service.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    expect(card.amounts.find((a) => a.key === 'opex_allocated')).toMatchObject({
      kopecks: -120_000,
      method: 'Пропорционально выручке',
    });
    expect(card.amounts.some((a) => a.key === 'other_expenses')).toBe(false);
  });

  it('товар без продаж в месяце — нераспределённое, сумма не теряется', async () => {
    await expenses.create(
      SELLER,
      oneOff({ category: 'packaging', amount: 120, scope: 'product', sku: 'ZZ' }),
    );
    const list = await service.orders(SELLER, {}, STORE, SEPT, {}, NOW);
    expect(list.unallocatedKopecks).toBe(-12_000);
  });
});

describe('CrmAccountingKinds — заказы', () => {
  const registry = { register: vi.fn() };
  let kinds: CrmAccountingKinds;
  beforeAll(() => {
    kinds = new CrmAccountingKinds(
      registry as never,
      {} as never,
      service,
      {} as never,
      {} as never,
      {} as never,
    );
  });
  const context = (params: Record<string, unknown>, store: unknown = STORE): ICrmJobContext => ({
    jobId: 'j1',
    telegramUserId: SELLER,
    store: store as never,
    params,
    features: {},
  });

  it('kind-ы под зонтиком и подфичей заказов, магазина из URL', () => {
    kinds.onModuleInit();
    const registered = Object.fromEntries(
      registry.register.mock.calls.map(([kind, def]) => [kind, def]),
    );
    expect(ACCOUNTING_ORDER_FEATURES).toEqual([
      FEATURE.FIN_ACCOUNTING,
      FEATURE.FIN_ACCOUNTING_ORDERS,
    ]);
    for (const kind of [ACCOUNTING_ORDER_KIND, ACCOUNTING_ORDERS_KIND]) {
      expect(registered[kind].features).toEqual(ACCOUNTING_ORDER_FEATURES);
      expect(registered[kind].scope).toBeUndefined();
    }
  });

  it('кривые params и чужой заказ — текст для продавца', async () => {
    await expect(kinds.order(context({ marketplace: 'x', orderId: '1' }))).rejects.toBeInstanceOf(
      CrmJobError,
    );
    await expect(kinds.order(context({ marketplace: 'ym', orderId: '1' }, null))).rejects.toThrow(
      CrmJobError,
    );
    await expect(kinds.order(context({ marketplace: 'ym', orderId: '2' }), NOW)).rejects.toThrow(
      'Заказ не найден',
    );
    await expect(kinds.orders(context({ month: '2026-13' }))).rejects.toBeInstanceOf(CrmJobError);
    await expect(
      kinds.orders(context({ month: '2026-09', state: 'final' })),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('ответ карточки — даты строками, без магазина ЯМ', async () => {
    const { data } = await kinds.order(context({ marketplace: 'ym', orderId: '1' }), NOW);
    const card = data as { marketplaceLabel: string; versions: { capturedAt: unknown }[] };
    expect(card.marketplaceLabel).toBeTruthy();
    expect(typeof card.versions[0].capturedAt).toBe('string');
    expect(JSON.stringify(data)).not.toContain(CAMPAIGN_ID);
  });

  it('ответ списка эхоит фильтр — фронт отличит ответ прежнего запроса', async () => {
    const { data } = await kinds.orders(context({ month: '2026-09', state: 'forecast' }), NOW);
    expect((data as { filter: unknown }).filter).toEqual({
      marketplace: null,
      state: 'forecast',
      lossOnly: false,
    });
    const plain = await kinds.orders(context({ month: '2026-09', lossOnly: true }), NOW);
    expect((plain.data as { filter: unknown }).filter).toEqual({
      marketplace: null,
      state: null,
      lossOnly: true,
    });
  });

  it('разбор params', () => {
    expect(parseAccountingOrderParams({ marketplace: 'wb', orderId: ' 7 ' })).toEqual({
      marketplace: 'wb',
      orderId: '7',
    });
    expect(parseAccountingOrdersFilter({ lossOnly: 'yes' })).toBeNull();
    expect(parseAccountingOrdersFilter({ marketplace: '', state: 'reconciled' })).toEqual({
      lossOnly: false,
      state: 'reconciled',
    });
  });
});
