import type { IAccountingCostRecord } from '../../src/modules/accounting/accounting-cost-history.domain';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type {
  IAccountingReconcileInput,
  IAccountingReconcileOperation,
  IAccountingReconcileResult,
  TReconcileLine,
} from '../../src/modules/accounting/accounting-reconcile.domain';
import type {
  IOrderResult,
  IOrderResultOperation,
  TOrderCostOf,
  TOrderResultKey,
} from '../../src/modules/accounting/order-result';
import type { IReturnResult, TReturnResultKey } from '../../src/modules/accounting/return-result';
import type { IDiscountConfig } from '../../src/modules/yandex/reports/profit';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { and, eq, isNull } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { financeDocuments, financeOperations } from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { accountingUnitCost } from '../../src/modules/accounting/accounting-cost-history.domain';
import {
  orderReconcileStateOf,
  reconcileV2,
} from '../../src/modules/accounting/accounting-reconcile.domain';
import { orderResultOf } from '../../src/modules/accounting/order-result';
import { returnResultOf } from '../../src/modules/accounting/return-result';
import { FinanceImportService } from '../../src/modules/finance/finance-import.service';
import { monthPeriod } from '../../src/modules/finance/finance-period';
import { WbFinanceService } from '../../src/modules/wb/wb-finance.service';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Приёмочные испытания ТЗ «Фактический финансовый учёт» п.15 №1–7 (TASK-232)
 * одним набором: `npx vitest run -t "ТЗ №"`. Фикстуры обезличены и нарочно
 * минимальны; подробные случаи — в тестах задач:
 *   №1, №4, №5 — accounting-order-result.test.ts (TASK-217)
 *   №2         — accounting-cost-history.test.ts (TASK-213)
 *   №3         — accounting-return-result.test.ts (TASK-224)
 *   №6         — finance-wb-promotion-upload.test.ts (TASK-209)
 *   №7         — accounting-reconcile.test.ts (TASK-226); живая сверка — TASK-234
 * Живой прогон на данных продавца — scripts/diagnose-accounting.ts.
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
const costBy =
  (records: IAccountingCostRecord[]): TOrderCostOf =>
  (_line, moment) =>
    accountingUnitCost({}, records, NO_DISCOUNTS, moment);

const COST_400 = costBy([rec('2026-10-01T00:00:00+03:00', 400)]);

const amount = (result: IOrderResult, key: TOrderResultKey) =>
  result.amounts.find((a) => a.key === key);

/** Итог строк карточки = чистая прибыль, всё в целых копейках. */
function expectNetIsSumOfAmounts(result: IOrderResult): void {
  expect(result.net.kopecks).toBe(result.amounts.reduce((s, a) => s + (a.kopecks ?? 0), 0));
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

describe('ТЗ №1 — комиссия каждого заказа из его операции, не процентом', () => {
  // Десять заказов одной цены с разными фактическими комиссиями: процент дал бы одно число.
  const fees = [1_234, 5_000, 7_777, 12_001, 3_300, 9_999, 15_050, 4_444, 8_080, 11_111];
  const results = fees.map((fee, i) => orderResultOf(ymOrder(`N1-${i}`, 200_000, fee)));

  it('комиссия = сумма операции заказа, источник actual, прибыль сходится с карточкой', () => {
    results.forEach((result, i) => {
      expect(amount(result, 'commission')).toMatchObject({
        kopecks: -fees[i],
        source: 'actual',
        operationIds: [`N1-${i}-fee`],
      });
      expect(result.net).toEqual({
        kopecks: 200_000 - fees[i] - 9_900 - 40_000,
        source: 'actual',
        unknown: null,
      });
      expectNetIsSumOfAmounts(result);
    });
    expect(new Set(results.map((r) => amount(r, 'commission')?.kopecks)).size).toBe(fees.length);
  });

  it('нет операции комиссии — комиссия неизвестна и прибыль null, а не 0 и не процент', () => {
    const order = ymOrder('N1-x', 200_000, 0);
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

describe('ТЗ №2 — закуп 1 500 → 1 800 после продажи не меняет её себестоимость', () => {
  const before = [rec('2026-11-01T09:00:00+03:00', 1500)];
  const after = [...before, rec('2026-11-10T09:00:00+03:00', 1800)];
  const sale = (soldOn: string) =>
    ymOrder('N2', 300_000, 30_000).lines.map((l) => ({ ...l, soldOn, createdOn: soldOn }));

  it('продажа 5.11: себестоимость 1 500 ₽ до и после новой цены 10.11', () => {
    const at = new Date('2026-11-05T14:00:00+03:00');
    expect(accountingUnitCost({}, before, NO_DISCOUNTS, at)).toMatchObject({
      status: 'known',
      kopecks: 150_000,
    });
    expect(accountingUnitCost({}, after, NO_DISCOUNTS, at)).toEqual(
      accountingUnitCost({}, before, NO_DISCOUNTS, at),
    );

    const order = { ...ymOrder('N2', 300_000, 30_000), lines: sale('2026-11-05') };
    const resultBefore = orderResultOf({ ...order, costOf: costBy(before) });
    const resultAfter = orderResultOf({ ...order, costOf: costBy(after) });
    expect(amount(resultBefore, 'cogs')?.kopecks).toBe(-150_000);
    expect(resultAfter.net).toEqual(resultBefore.net);
  });

  it('продажа 11.11 — уже 1 800 ₽', () => {
    const order = { ...ymOrder('N2', 300_000, 30_000), lines: sale('2026-11-11') };
    expect(amount(orderResultOf({ ...order, costOf: costBy(after) }), 'cogs')?.kopecks).toBe(
      -180_000,
    );
  });
});

describe('ТЗ №3 — возврат: 150 + 180 + 50 = 380, позже компенсация 50 → 330', () => {
  const returnedLine = line({ status: 'RETURNED', returnedOn: '2026-10-20' });
  const ops = [
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
  const of = (operations: IOrderResultOperation[]) =>
    returnResultOf({ marketplace: 'ym', orderId: '100', lines: [returnedLine], operations });
  const part = (result: IReturnResult, key: TReturnResultKey) =>
    result.amounts.find((a) => a.key === key)?.kopecks;

  it('до компенсации результат возврата −380 ₽, выручка 0', () => {
    const result = of(ops);
    expect(result.returned).toBe(true);
    expect(result.logisticsKopecks).toBe(-38_000);
    expect(result.resultKopecks).toBe(-38_000);
    expect(part(result, 'revenue')).toBe(0);
  });

  it('компенсация 50 ₽ отдельной строкой: логистика −380, результат −330', () => {
    const result = of([...ops, op({ id: 'comp', article: 'compensations', amountKopecks: 5_000 })]);
    expect(result.logisticsKopecks).toBe(-38_000);
    expect(part(result, 'compensations')).toBe(5_000);
    expect(result.resultKopecks).toBe(-33_000);
  });
});

describe('ТЗ №4 — Ozon: цена покупателя, цена продавца, признанный доход', () => {
  it('скидка площадки 200 ₽ не уменьшает выручку продавца 1 000 ₽', () => {
    const result = orderResultOf({
      marketplace: 'ozon',
      orderId: 'P-1',
      lines: [
        line({
          marketplace: 'ozon',
          orderId: 'P-1',
          priceKopecks: 100_000,
          buyerPriceKopecks: 80_000,
          marketplaceSubsidyKopecks: 20_000,
          revenueKopecks: 100_000,
          payoutKopecks: 85_000,
          commissionKopecks: 15_000,
          status: 'delivered',
          source: 'ozon-postings',
        }),
      ],
      operations: [
        op({
          id: 'o1',
          orderId: 'P-1',
          marketplace: 'ozon',
          article: 'sales',
          amountKopecks: 100_000,
        }),
        op({
          id: 'o1',
          orderId: 'P-1',
          marketplace: 'ozon',
          article: 'commission',
          amountKopecks: -15_000,
        }),
        op({
          id: 'o2',
          orderId: 'P-1',
          marketplace: 'ozon',
          article: 'delivery_to_buyer',
          amountKopecks: -7_600,
        }),
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
    expect(result.net.kopecks).toBe(100_000 - 15_000 - 7_600 - 40_000);
    expectNetIsSumOfAmounts(result);
  });

  it('субсидия в выручке один раз, компенсация — своей строкой', () => {
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
    expect(amount(result, 'compensations')?.kopecks).toBe(3_000);
    expect(result.net.kopecks).toBe(100_000 - 10_000 - 5_000 + 3_000 - 40_000);
  });
});

describe('ТЗ №5 — корректировка через несколько дней пересчитывает результат', () => {
  it('операция корректировки меняет прибыль ровно на свою сумму, исходная не теряется', () => {
    const order = ymOrder('N5', 150_000, 12_000);
    const before = orderResultOf(order);
    const correction = op({
      id: 'N5-fee-fix',
      orderId: 'N5',
      article: 'commission',
      subArticle: 'commission_reversal',
      amountKopecks: 2_500,
      accruedAt: new Date('2026-10-09T09:00:00Z'),
    });
    const after = orderResultOf({ ...order, operations: [...order.operations, correction] });
    expect(after.net.kopecks).toBe((before.net.kopecks as number) + 2_500);
    expect(amount(after, 'commission')).toMatchObject({
      kopecks: -9_500,
      operationIds: ['N5-fee', 'N5-fee-fix'],
    });
    expectNetIsSumOfAmounts(after);
  });
});

describe('ТЗ №6 — повторная загрузка того же отчёта не создаёт повторных начислений', () => {
  const SELLER = '111';
  const SEPT = monthPeriod(2026, 9);
  const NOW = new Date('2026-10-18T07:00:00Z');
  const HEADER = [
    'ID кампании',
    'Название кампании',
    'Тип кампании',
    'Дата списания',
    'Номер документа',
    'Сумма списания, ₽',
    'Источник списания',
  ];
  const spend = (id: number, date: string, sum: string) => [
    String(id),
    `Кампания ${id}`,
    'Аукцион',
    date,
    `D-${id}`,
    sum,
    'Счёт',
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      HEADER,
      spend(1, '05.09.2026 10:15', '1500,50'),
      spend(2, '06.09.2026 11:00', '200'),
    ]),
    'Затраты',
  );
  const FILE = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  let test: ITestFinanceDb;
  let wb: WbFinanceService;

  beforeAll(async () => {
    test = await createTestFinanceDb();
  }, 60_000);

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.reset();
    const report = vi.fn(async () => undefined);
    const imports = new FinanceImportService(
      {} as never,
      {} as never,
      new FinanceDocumentRepository(test.db),
      new FinanceOperationRepository(test.db),
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      { reconcilePeriod: vi.fn(() => Promise.reject(new Error('не для файла'))) } as never,
      { detectPeriod: vi.fn(() => Promise.reject(new Error('не для файла'))) } as never,
      new FinanceActServicesRepository(test.db),
    );
    wb = new WbFinanceService(
      { forToken: () => ({ listRealizationReport: async () => [] }) } as never,
      {
        credentialsOf: async () => ({ token: 'SECRET' }),
        findOne: async () => ({ accounts: [{ id: 'sid-1', name: 'Магазин' }] }),
      } as never,
      { findByMarketplaceSkus: async () => [] } as never,
      imports,
      { report } as never,
    );
  });

  const upload = () =>
    wb.importPromotionFile(SELLER, SEPT, { buffer: FILE, filename: 'promo.xlsx' }, NOW);
  const liveOps = () =>
    test.db
      .select()
      .from(financeOperations)
      .where(and(eq(financeOperations.marketplace, 'wb'), isNull(financeOperations.supersededAt)));
  const total = async () => (await liveOps()).reduce((s, o) => s + o.amountKopecks, 0);

  it('тот же файл второй раз — unchanged, 0 новых строк, сумма периода та же, один документ', async () => {
    expect(await upload()).toMatchObject({ status: 'imported', inserted: 2 });
    expect(await liveOps()).toHaveLength(2);
    expect(await total()).toBe(-170_050);

    expect(await upload()).toMatchObject({ status: 'unchanged', rows: 2 });
    expect(await liveOps()).toHaveLength(2);
    expect(await total()).toBe(-170_050);
    expect(await test.db.select().from(financeDocuments)).toHaveLength(1);
  });
});

describe('ТЗ №7 — сверка закрытого периода: необъяснённое расхождение 0 копеек', () => {
  const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
  let seq = 0;
  const rop = (over: Partial<IAccountingReconcileOperation>): IAccountingReconcileOperation => ({
    id: `op-${++seq}`,
    source: 'journal',
    orderId: '1',
    article: 'sales',
    subArticle: null,
    amountKopecks: 0,
    accruedOn: '2026-09-10',
    actDay: null,
    bankOrderId: 'B1',
    bankSumKopecks: 92_000,
    paidOn: '2026-09-20',
    serviceName: null,
    ...over,
  });
  const balanced = () => [
    rop({ article: 'sales', subArticle: 'sale', amountKopecks: 100_000 }),
    rop({
      article: 'commission',
      subArticle: 'commission',
      amountKopecks: -5_000,
      actDay: '2026-09-30',
      serviceName: 'Размещение товарных предложений',
    }),
    rop({
      article: 'delivery_to_buyer',
      subArticle: 'delivery',
      amountKopecks: -3_000,
      actDay: '2026-09-30',
      serviceName: 'Доставка покупателю',
    }),
  ];
  const input = (operations: IAccountingReconcileOperation[]): IAccountingReconcileInput => ({
    period: SEPTEMBER,
    operations,
    acts: [
      { actDay: '2026-09-30', totalKopecks: 8_000, sheets: { placement: 5_000, delivery: 3_000 } },
    ],
    closed: true,
    loaded: { month: true, prev: true, next: true },
    dataAsOf: new Date('2026-11-08T06:00:00Z'),
    now: new Date('2026-11-08T09:00:00Z'),
  });
  const lineOf = (result: IAccountingReconcileResult, key: TReconcileLine) =>
    result.lines.find((l) => l.line === key);

  it('реестр и документы сходятся — «сверено», разница каждой статьи с документом 0', () => {
    const result = reconcileV2(input(balanced()));
    expect(result.status).toBe('reconciled');
    const withDocument = result.lines.filter((l) => l.documentKopecks !== null);
    expect(withDocument.map((l) => l.line)).toEqual(
      expect.arrayContaining(['commission', 'logistics', 'payouts']),
    );
    for (const l of withDocument)
      expect(l).toMatchObject({ differenceKopecks: 0, status: 'matched' });
    expect(result.acts.every((a) => a.status === 'matched')).toBe(true);
    expect(result.candidateCount).toBe(0);
  });

  it('лишние 150 ₽ комиссии — расхождение объяснено найденной операцией', () => {
    const result = reconcileV2(
      input([
        ...balanced(),
        rop({
          id: 'op-extra',
          orderId: '2',
          article: 'commission',
          subArticle: 'commission',
          amountKopecks: -15_000,
          actDay: '2026-09-30',
          bankOrderId: null,
          bankSumKopecks: null,
          paidOn: null,
          serviceName: 'Размещение товарных предложений',
        }),
      ]),
    );
    expect(result.status).toBe('discrepancies');
    const commission = lineOf(result, 'commission');
    expect(commission).toMatchObject({ status: 'mismatch', differenceKopecks: -15_000 });
    expect(commission?.candidates.items[0]).toMatchObject({
      operationId: 'op-extra',
      reason: 'no_pair',
      matchesDifference: true,
    });
    expect(orderReconcileStateOf(result, '2')).toBe('discrepancy');
    expect(orderReconcileStateOf(result, '1')).toBe('reconciled');
  });
});
