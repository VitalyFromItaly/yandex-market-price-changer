import type { TFinancePeriodStatus } from '../../src/modules/finance/finance-period-status';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import {
  FLAT_FAILED,
  FLAT_ONLY_CURRENT_MONTH,
  FinanceService,
} from '../../src/modules/finance/finance.service';
import { ACTUAL_ALL_REASON } from '../../src/modules/finance/profit-actual';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * FinanceService (TASK-120) на PGlite: журнал пишется настоящими репозиториями
 * из строк netting, Mongo-двери (магазин, закуп, история) и «Прибыль» — заглушки.
 */

const SELLER = '111';
const SEPT = monthPeriod(2026, 9);
const SEPT_KEY = financePeriodKey('united-netting', SEPT);

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
  bankOrderDate: '20.09.2026',
  bankSum: 5000,
  ...over,
});

let test: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;

const profit = { build: vi.fn() };
const errors = { report: vi.fn() };
const store = { telegramUserId: SELLER, commissionPercent: 23, taxPercent: 7, discountPercent: 0 };

function service(hasStore = true) {
  return new FinanceService(
    operations,
    periods,
    new FinanceTaxService(new FinanceTaxSettingsRepository(test.db)),
    new FinanceExpensesService(new FinanceExpenseRepository(test.db)),
    { findByTelegramUser: async () => (hasStore ? store : null) } as never,
    {
      findBySkus: async (_user: string, skus: string[]) =>
        new Map(skus.filter((s) => s === 'A1').map((s) => [s, { price: 1500 }])),
    } as never,
    { findForSkus: async () => new Map() } as never,
    profit as never,
    errors as never,
  );
}

async function seed(rows: Record<string, unknown>[], telegramUserId = SELLER, content = 'v1') {
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    buffer: Buffer.from(content),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  const keys = journalKeys(rows);
  const ops = rows.map((r, i) =>
    nettingRowToOperation(r, keys[i], {
      telegramUserId,
      businessId: 'b1',
      documentId: document.id,
      documentVersion: document.version,
      periodKey: SEPT_KEY,
    }),
  );
  await operations.upsertMany(ops);
  return ops;
}

async function setStatus(status: TFinancePeriodStatus) {
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId: SELLER,
    reportType: 'united-netting',
    periodKey: SEPT_KEY,
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    checkedAt: new Date(),
    status,
    lastOutcome: 'imported',
    documentVersion: 1,
    unknownCount: 0,
    changedCount: 0,
    removedCount: 0,
    discrepancyCount: 0,
    reconcileState: 'checked',
    reconcileNote: null,
    error: null,
  });
}

const OCT_15 = new Date('2026-10-15T09:00:00Z');

beforeAll(async () => {
  test = await createTestFinanceDb();
  operations = new FinanceOperationRepository(test.db);
  documents = new FinanceDocumentRepository(test.db);
  periods = new FinancePeriodRepository(test.db);
}, 60_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await test.reset();
  profit.build.mockReset();
  errors.report.mockReset();
});

describe('FinanceService.build', () => {
  it('P&L из журнала: выручка, услуги, себестоимость по штукам из сырой строки, налог 6 %', async () => {
    await seed([
      row(),
      row({
        transactionType: 'Удержание',
        transactionSource: 'Оплата услуг Маркета',
        offerOrServiceName: 'Размещение товарных предложений',
        transactionSum: -1150,
        count: null,
        actDate: '30.09.2026',
      }),
      // Начислено в октябре — в сентябрьский P&L не идёт.
      row({ orderId: 2, transactionDate: '02.10.2026 10:00', bankOrderDate: null, bankSum: null }),
    ]);
    // Чужой продавец не задет.
    await seed([row({ transactionSum: 999_999 })], '222', 'other');

    const report = await service().build(SELLER, SEPT, OCT_15);
    expect(report.pnl.revenueKopecks).toBe(500_000);
    expect(report.pnl.byArticle.commission.kopecks).toBe(-115_000);
    expect(report.pnl.cogs).toMatchObject({ kopecks: 300_000, unknown: [] });
    expect(report.pnl.tax.taxKopecks).toBe(30_000);
    expect(report.pnl.netKopecks).toBe(500_000 - 115_000 - 300_000 - 30_000);
    expect(report.taxIsDefault).toBe(true);
  });

  it('снятые новой версией строки в P&L не попадают', async () => {
    const [first, second] = await seed([row(), row({ orderId: 2, transactionSum: 3000 })]);
    await operations.markSuperseded(SELLER, [second.operationKey], 2);
    const report = await service().build(SELLER, SEPT, OCT_15);
    expect(report.pnl.byArticle.sales.kopecks).toBe(first.amountKopecks);
  });

  it('налог по поступлению берёт выплаченное в периоде, даже начисленное раньше', async () => {
    await seed([row({ transactionDate: '28.08.2026 10:00', bankOrderDate: '03.09.2026' })]);
    const report = await service().build(SELLER, SEPT, OCT_15);
    expect(report.pnl.revenueKopecks).toBe(0);
    expect(report.pnl.tax.incomeKopecks).toBe(500_000);
  });

  it('статус из finance_periods; проверенный период — без плоской оценки', async () => {
    await seed([row()]);
    await setStatus('verified');
    const report = await service().build(SELLER, SEPT, OCT_15);
    expect(report.status).toBe('verified');
    expect(report.statusLabel).toBe('Проверено');
    expect(report).toMatchObject({ flat: null, flatNote: null });
    expect(profit.build).not.toHaveBeenCalled();
  });

  it('прошлый непроверенный месяц — «Предварительные данные» без плоской, с причиной', async () => {
    const report = await service().build(SELLER, SEPT, OCT_15);
    expect(report.status).toBe('preliminary');
    expect(report.months).toEqual([{ from: SEPT.from, to: SEPT.to, status: null }]);
    expect(report.flatNote).toBe(FLAT_ONLY_CURRENT_MONTH);
    expect(profit.build).not.toHaveBeenCalled();
  });

  it('текущий месяц — плоская оценка «Прибыли» с периодом «с 1 числа»', async () => {
    const totals = {
      revenue: 100,
      commission: 23,
      tax: 7,
      promo: 0,
      purchase: 40,
      net: 30,
      orders: 1,
    };
    profit.build.mockResolvedValue({ placed: totals, totals: { ...totals, orders: 0 } });
    const report = await service().build(SELLER, monthPeriod(2026, 10), OCT_15);
    expect(profit.build).toHaveBeenCalledWith(store, { key: 'month' }, OCT_15);
    expect(report.flat).toMatchObject({
      label: 'Предварительные данные',
      block: 'placed',
      net: 30,
    });
  });

  it('сбой плоской оценки P&L не роняет', async () => {
    profit.build.mockRejectedValue(new Error('Маркет недоступен'));
    const report = await service().build(SELLER, monthPeriod(2026, 10), OCT_15);
    expect(report.flat).toBeNull();
    expect(report.flatNote).toBe(FLAT_FAILED);
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'finance:pnl-flat', alert: false }),
    );
  });
});

describe('FinanceService.actualNet — «Фактическая чистая» в «Прибыли» (TASK-126)', () => {
  const PREV_MONTH = { key: 'prevmonth' } as const;

  it('проверенный прошлый месяц — та же чистая, что P&L «Финансов» за этот месяц', async () => {
    await seed([row()]);
    await setStatus('verified');

    const actual = await service().actualNet(SELLER, PREV_MONTH, OCT_15);
    const pnl = await service().build(SELLER, SEPT, OCT_15, { flat: false });

    expect(actual).toMatchObject({
      state: 'verified',
      netKopecks: pnl.pnl.netKopecks,
      from: SEPT.from,
      to: SEPT.to,
    });
    expect(profit.build).not.toHaveBeenCalled();
  });

  it('непроверенный месяц — «предварительно» со статусом, P&L не строится', async () => {
    await seed([row()]);
    await setStatus('discrepancy');
    const build = vi.spyOn(FinanceService.prototype, 'build');

    const actual = await service().actualNet(SELLER, PREV_MONTH, OCT_15);

    expect(actual.state).toBe('preliminary');
    expect(actual.state !== 'verified' && actual.reason).toContain('Есть расхождения');
    expect(build).not.toHaveBeenCalled();
    build.mockRestore();
  });

  it('текущий месяц и «Всего» — «предварительно», не проверено по построению', async () => {
    await seed([row()]);
    await setStatus('verified');

    expect((await service().actualNet(SELLER, { key: 'month' }, OCT_15)).state).toBe(
      'preliminary',
    );
    const all = await service().actualNet(SELLER, { key: 'all' }, OCT_15);
    expect(all).toEqual({ state: 'preliminary', reason: ACTUAL_ALL_REASON });
  });

  it('сбой базы — «недоступно», отчёт не падает, журнал без алерта', async () => {
    const broken = service();
    vi.spyOn(periods, 'find').mockRejectedValueOnce(new Error('pg down'));

    const actual = await broken.actualNet(SELLER, PREV_MONTH, OCT_15);

    expect(actual.state).toBe('unavailable');
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'finance:profit-actual', alert: false }),
    );
  });
});
