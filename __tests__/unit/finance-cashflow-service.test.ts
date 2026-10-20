import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * ДДС (TASK-122) на PGlite рядом с настоящим P&L: закупка меняет денежный
 * поток и не меняет чистую прибыль; «к получению» = начислено − выплачено.
 */

const SELLER = '111';
const SEPT = monthPeriod(2026, 9);
const OCT = monthPeriod(2026, 10);
const SEPT_KEY = financePeriodKey('united-netting', SEPT);
const NOW = new Date('2026-10-15T09:00:00Z');

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 2,
  transactionSum: 5000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '05.10.2026',
  bankSum: 5000,
  ...over,
});

const unpaid = (over: Record<string, unknown> = {}) =>
  row({ paymentStatus: null, bankOrderId: null, bankOrderDate: null, bankSum: null, ...over });

let test: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let purchases: FinancePurchasesService;
let expenses: FinanceExpensesService;
let cashflow: FinanceCashflowService;
let pnl: FinanceService;

async function seed(rows: Record<string, unknown>[]) {
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
  const keys = journalKeys(rows);
  await operations.upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: SEPT_KEY,
      }),
    ),
  );
}

beforeAll(async () => {
  test = await createTestFinanceDb();
  operations = new FinanceOperationRepository(test.db);
  documents = new FinanceDocumentRepository(test.db);
  purchases = new FinancePurchasesService(new FinancePurchaseRepository(test.db));
  expenses = new FinanceExpensesService(new FinanceExpenseRepository(test.db));
  cashflow = new FinanceCashflowService(operations, expenses, purchases);
  pnl = new FinanceService(
    operations,
    new FinancePeriodRepository(test.db),
    new FinanceTaxService(new FinanceTaxSettingsRepository(test.db)),
    expenses,
    { findByTelegramUser: async () => null } as never,
    {
      findBySkus: async (_user: string, skus: string[]) =>
        new Map(skus.filter((s) => s === 'A1').map((s) => [s, { price: 1500 }])),
    } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
}, 60_000);

afterAll(() => test?.close());
beforeEach(() => test.reset());

describe('FinanceCashflowService', () => {
  it('закупка меняет ДДС и не меняет чистую прибыль', async () => {
    await seed([
      row(),
      row({ orderId: 2, transactionSum: 3000, bankSum: 8000 }),
      unpaid({ orderId: 3 }),
    ]);

    const pnlBefore = await pnl.build(SELLER, SEPT, NOW);
    const flowBefore = await cashflow.build(SELLER, OCT, NOW);

    await purchases.createPurchase(SELLER, {
      supplier: 'Восток',
      paidDay: '2026-10-03',
      amount: 40_000,
    });
    await purchases.createPurchase(SELLER, {
      supplier: 'Восток',
      paidDay: '2026-09-10',
      amount: 70_000,
    });

    const pnlAfter = await pnl.build(SELLER, SEPT, NOW);
    const flowAfter = await cashflow.build(SELLER, OCT, NOW);
    const septFlow = await cashflow.build(SELLER, SEPT, NOW);

    expect(pnlAfter.pnl.netKopecks).toBe(pnlBefore.pnl.netKopecks);
    expect(pnlAfter.pnl).toEqual(pnlBefore.pnl);
    expect(flowBefore.cashflow.outflow.purchasesKopecks).toBe(0);
    expect(flowAfter.cashflow.outflow.purchasesKopecks).toBe(4_000_000);
    expect(flowAfter.cashflow.netKopecks).toBe(flowBefore.cashflow.netKopecks - 4_000_000);
    // Сентябрьская закупка — в ДДС сентября, не октября.
    expect(septFlow.cashflow.outflow.purchasesKopecks).toBe(7_000_000);
  });

  it('выплата, начисленная в сентябре, — поступление октября по дате поручения', async () => {
    await seed([row(), row({ orderId: 2, transactionSum: 3000, bankSum: 5000 })]);
    // Строки поручения P1: 5000 + 3000 ≠ 5000 — флаг; вторая — то же поручение.
    const { cashflow: flow } = await cashflow.build(SELLER, OCT, NOW);
    expect(flow.payouts).toHaveLength(1);
    expect(flow.payouts[0]).toMatchObject({
      bankOrderId: 'P1',
      day: '2026-10-05',
      kopecks: 500_000,
    });
    expect(flow.payouts[0].mismatch).toBe(true);
    expect((await cashflow.build(SELLER, SEPT, NOW)).cashflow.payouts).toEqual([]);
  });

  it('к получению = Σ начислений − Σ выплаченного', async () => {
    await seed([
      row(),
      row({ orderId: 2, transactionSum: 3000, bankSum: 8000 }),
      unpaid({ orderId: 3, transactionSum: 2000 }),
      unpaid({
        orderId: 3,
        transactionSource: 'Вознаграждение за продажу',
        transactionType: 'Удержание',
        transactionSum: -460,
      }),
    ]);
    const accrued = 500_000 + 300_000 + 200_000 - 46_000;
    const paidOut = 500_000 + 300_000;
    const { receivable } = await cashflow.build(SELLER, OCT, NOW);
    expect(receivable.totalKopecks).toBe(accrued - paidOut);
    expect(receivable.asOf).toBe('2026-10-15');
  });

  it('ежемесячный расход и уплаченный налог — в ДДС, неверный период — ошибка поля', async () => {
    await expenses.create(SELLER, {
      kind: 'monthly',
      category: 'rent',
      amount: 30_000,
      fromDay: '2026-08-05',
    });
    await purchases.createTaxPayment(SELLER, { paidDay: '2026-10-25', amount: 12_000 });
    const { cashflow: flow } = await cashflow.build(SELLER, OCT, NOW);
    expect(flow.outflow).toMatchObject({
      expensesKopecks: 3_000_000,
      taxesKopecks: 1_200_000,
      totalKopecks: 4_200_000,
    });
    await expect(
      cashflow.build(SELLER, { from: '2026-10-31', to: '2026-10-01' }),
    ).rejects.toMatchObject({
      field: 'period',
    });
  });
});
