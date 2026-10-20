import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import {
  financeCorrections,
  financeOperations,
  financePeriods,
} from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import {
  FinanceImportService,
  RECONCILE_NOT_IMPLEMENTED,
} from '../../src/modules/finance/finance-import.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FLAT_YM_ONLY, FinanceService } from '../../src/modules/finance/finance.service';
import { WB_UNKNOWN_ARTICLE_CONTEXT } from '../../src/modules/finance/wb-journal';
import {
  WB_FINANCE_SKU_CONTEXT,
  WB_REPORT_MARGIN_DAYS,
  WbFinanceService,
  wbPurchaseKeys,
} from '../../src/modules/wb/wb-finance.service';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Импорт отчёта реализации WB (TASK-136) на PGlite: настоящие репозитории и
 * транзакция версии, «WB» и Mongo-двери — заглушки. Поля строки — по памяти
 * (доки WB автоматике не отдаются), живой отчёт не сверен (known-gaps).
 */

const SELLER = '111';
const SEPT = monthPeriod(2026, 9);
const WB_KEY = financePeriodKey('wb-realization-report', SEPT);
const NOW = new Date('2026-10-18T07:00:00Z');

const sale = (rrdId: number, over: Record<string, unknown> = {}) => ({
  rrd_id: rrdId,
  realizationreport_id: 555,
  rr_dt: '2026-09-16',
  supplier_oper_name: 'Продажа',
  doc_type_name: 'Продажа',
  sa_name: 'VC-1',
  srid: `srid-${rrdId}`,
  quantity: 1,
  retail_price_withdisc_rub: 2000,
  acquiring_fee: 30,
  ppvz_for_pay: 1600,
  delivery_rub: 0,
  storage_fee: 0,
  penalty: 0,
  deduction: 0,
  acceptance: 0,
  additional_payment: 0,
  ...over,
});

const logistics = (rrdId: number, over: Record<string, unknown> = {}) =>
  sale(rrdId, {
    supplier_oper_name: 'Логистика',
    doc_type_name: '',
    quantity: 0,
    retail_price_withdisc_rub: 0,
    acquiring_fee: 0,
    ppvz_for_pay: 0,
    delivery_rub: 75,
    ...over,
  });

let test: ITestFinanceDb;

beforeAll(async () => {
  test = await createTestFinanceDb();
}, 60_000);

afterAll(async () => {
  await test?.close();
});

describe('WB → журнал finance_operations', () => {
  let rowsOfWb: Record<string, unknown>[];
  let products: () => Promise<unknown[]>;
  let credentials: Record<string, string> | null;
  let report: ReturnType<typeof vi.fn>;
  let listRealizationReport: ReturnType<typeof vi.fn>;
  let wb: WbFinanceService;
  let operationsRepo: FinanceOperationRepository;

  beforeEach(async () => {
    await test.reset();
    rowsOfWb = [sale(1), sale(2), logistics(3), sale(4, { rr_dt: '2026-08-30' })];
    products = async () => [{ marketplaceSkus: { wb: 'VC-1', ym: 'A1' } }];
    credentials = { token: 'SECRET' };
    report = vi.fn(async () => undefined);
    operationsRepo = new FinanceOperationRepository(test.db);

    const imports = new FinanceImportService(
      {} as never,
      {} as never,
      new FinanceDocumentRepository(test.db),
      operationsRepo,
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      // Сверка и аномалии — правила ЯМ: путь WB их не зовёт.
      { reconcilePeriod: vi.fn(() => Promise.reject(new Error('не для WB'))) } as never,
      { detectPeriod: vi.fn(() => Promise.reject(new Error('не для WB'))) } as never,
      new FinanceActServicesRepository(test.db),
    );
    listRealizationReport = vi.fn(async () => rowsOfWb);
    wb = new WbFinanceService(
      { forToken: () => ({ listRealizationReport }) } as never,
      {
        credentialsOf: async () => credentials,
        findOne: async () => ({ accounts: [{ id: 'sid-1', name: 'Магазин' }] }),
      } as never,
      { findByMarketplaceSkus: vi.fn(() => products()) } as never,
      imports,
      { report } as never,
    );
  });

  const run = () => wb.importPeriod(SELLER, SEPT, NOW);
  const rows = () =>
    test.db.select().from(financeOperations).where(eq(financeOperations.marketplace, 'wb'));

  it('запрос — месяц с запасом, в журнал — строки месяца; повтор — unchanged, 0 новых', async () => {
    expect(await run()).toMatchObject({ status: 'imported', rows: 3, inserted: 3, unknown: 0 });
    expect(listRealizationReport).toHaveBeenCalledWith('2026-08-26', '2026-10-06');
    expect(WB_REPORT_MARGIN_DAYS).toBe(6);

    const written = await rows();
    expect(written).toHaveLength(3);
    expect(written.every((r) => r.periodKey === WB_KEY && r.businessId === 'sid-1')).toBe(true);
    expect(written.filter((r) => r.transactionType === 'Продажа').map((r) => r.sku)).toEqual([
      'A1',
      'A1',
    ]);

    expect(await run()).toMatchObject({ status: 'unchanged', rows: 3 });
    expect(await rows()).toHaveLength(3);
  });

  it('Σ сумм строк недельного отчёта в журнале = к перечислению', async () => {
    await run();
    const total = (await rows()).reduce((sum, r) => sum + r.amountKopecks, 0);
    // 1600 + 1600 − 75 ₽.
    expect(total).toBe(312500);
  });

  it('пересчитанная строка — корректировка «изменено», пропавшая — «удалено»', async () => {
    await run();
    rowsOfWb = [sale(1, { ppvz_for_pay: 1590 }), logistics(3)];
    expect(await run()).toMatchObject({
      status: 'imported',
      inserted: 1,
      superseded: 2,
      changed: 1,
      removed: 1,
    });
    const corrections = await test.db.select().from(financeCorrections);
    expect(corrections.map((c) => [c.marketplace, c.kind]).sort()).toEqual([
      ['wb', 'changed'],
      ['wb', 'removed'],
    ]);
  });

  it('журнал ЯМ и Ozon WB не видят', async () => {
    await run();
    const from = new Date('2026-09-01T00:00:00+03:00');
    const to = new Date('2026-10-01T00:00:00+03:00');
    expect(await operationsRepo.liveForPnl(SELLER, from, to)).toEqual([]);
    expect(await operationsRepo.liveForPnl(SELLER, from, to, 'ozon')).toEqual([]);
    expect(await operationsRepo.liveForPnl(SELLER, from, to, 'wb')).not.toEqual([]);
  });

  it('статус периода — свой; без сверки закрытый месяц не «Проверено»', async () => {
    await run();
    const [state] = await test.db
      .select()
      .from(financePeriods)
      .where(and(eq(financePeriods.marketplace, 'wb'), eq(financePeriods.periodKey, WB_KEY)));
    expect(state).toMatchObject({
      reportType: 'wb-realization-report',
      reconcileState: 'unchecked',
      reconcileNote: RECONCILE_NOT_IMPLEMENTED,
    });
    expect(state.status).not.toBe('verified');
  });

  it('пустой месяц — empty; нет токена — отказ до записи статуса', async () => {
    rowsOfWb = [sale(4, { rr_dt: '2026-08-30' })];
    expect(await run()).toEqual({ status: 'empty', period: SEPT });

    credentials = null;
    await expect(run()).rejects.toBeInstanceOf(WbNotConnectedError);
    expect(await test.db.select().from(financePeriods)).toHaveLength(1);
  });

  it('незнакомый тип — статья unknown и один алерт', async () => {
    rowsOfWb = [logistics(1, { supplier_oper_name: 'Новая услуга WB' })];
    expect(await run()).toMatchObject({ status: 'imported', unknown: 1 });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: WB_UNKNOWN_ARTICLE_CONTEXT }),
    );
  });

  it('товары не ответили — артикул продавца и алерт; ответили — артикул ЯМ дописан', async () => {
    products = () => Promise.reject(new Error('Mongo down'));
    await run();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: WB_FINANCE_SKU_CONTEXT }),
    );
    expect((await rows()).find((r) => r.orderId === 'srid-1')?.sku).toBe('VC-1');

    products = async () => [{ marketplaceSkus: { wb: 'VC-1', ym: 'A1' } }];
    expect(await run()).toMatchObject({ status: 'imported', inserted: 0, superseded: 0 });
    expect((await rows()).find((r) => r.orderId === 'srid-1')?.sku).toBe('A1');
  });

  it('P&L WB тем же движком: выручка, комиссия, эквайринг, закуп — по разу', async () => {
    rowsOfWb = [sale(1), logistics(3)];
    await run();
    const finance = new FinanceService(
      operationsRepo,
      new FinancePeriodRepository(test.db),
      new FinanceTaxService(new FinanceTaxSettingsRepository(test.db)),
      new FinanceExpensesService(new FinanceExpenseRepository(test.db)),
      { findByTelegramUser: async () => null } as never,
      {
        findBySkus: async (_user: string, skus: string[]) =>
          new Map(skus.filter((s) => s === 'A1').map((s) => [s, { price: 1500 }])),
      } as never,
      { findForSkus: async () => new Map() } as never,
      { build: vi.fn() } as never,
      { report } as never,
    );

    const wbPnl = await finance.build(SELLER, SEPT, NOW, { marketplace: 'wb' });
    expect(wbPnl.pnl.revenueKopecks).toBe(200000);
    expect(wbPnl.pnl.cogs.kopecks).toBe(135000);
    expect(wbPnl.pnl.units).toBe(1);
    // Комиссия −370, эквайринг −30, логистика −75 ₽.
    expect(wbPnl.pnl.marketplaceKopecks).toBe(-47500);
    expect(wbPnl.pnl.ordersCount).toBe(1);
    expect(wbPnl.flatNote).toBe(FLAT_YM_ONLY);

    const ymPnl = await finance.build(SELLER, SEPT, NOW, { flat: false });
    expect(ymPnl.pnl.revenueKopecks).toBe(0);
  });
});

describe('wbPurchaseKeys', () => {
  it('артикул продавца → артикул ЯМ привязанного товара; без ЯМ — нет ключа', () => {
    expect(
      wbPurchaseKeys([
        { marketplaceSkus: { wb: 'VC-1', ym: 'A1' } },
        { marketplaceSkus: { wb: 'VC-2' } },
        {},
      ]),
    ).toEqual(new Map([['VC-1', 'A1']]));
  });
});
