import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import type { IOzonPosting } from '../../src/modules/ozon/ozon.client';

import {
  financeCorrections,
  financeDiscrepancies,
  financeOperations,
  financePeriods,
} from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { FinanceImportService } from '../../src/modules/finance/finance-import.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceReconcileService } from '../../src/modules/finance/finance-reconcile.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FLAT_YM_ONLY, FinanceService } from '../../src/modules/finance/finance.service';
import { OZON_UNKNOWN_ARTICLE_CONTEXT } from '../../src/modules/finance/ozon-journal';
import {
  OZON_FINANCE_SKU_CONTEXT,
  OzonFinanceService,
  ozonPurchaseKeys,
} from '../../src/modules/ozon/ozon-finance.service';
import { OzonNotConnectedError } from '../../src/modules/ozon/ozon-seller-client';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Импорт финансовых операций Ozon (TASK-131) на PGlite: настоящие репозитории и
 * транзакция версии, «Ozon» и Mongo-двери — заглушки. Форма операции — по
 * Go-клиенту; живой ответ не сверен (known-gaps).
 */

const SELLER = '111';
const SEPT = monthPeriod(2026, 9);
const OZON_KEY = financePeriodKey('ozon-transaction-list', SEPT);
// 18-10-2026: сентябрь закрыт.
const NOW = new Date('2026-10-18T07:00:00Z');

const sale = (id: number, over: Record<string, unknown> = {}) => ({
  operation_id: id,
  operation_type: 'OperationAgentDeliveredToCustomer',
  operation_type_name: 'Доставка покупателю',
  operation_date: '2026-09-16 00:00:00',
  type: 'orders',
  accruals_for_sale: 2000,
  sale_commission: -300,
  delivery_charge: 0,
  return_delivery_charge: 0,
  amount: 1700,
  posting: { delivery_schema: 'FBS', posting_number: `P-${id}` },
  items: [{ name: 'Часы', sku: 900001 }],
  services: [],
  ...over,
});

const storage = (id: number, date = '2026-09-20 00:00:00') => ({
  operation_id: id,
  operation_type: 'OperationMarketplaceServiceStorage',
  operation_date: date,
  type: 'services',
  accruals_for_sale: 0,
  sale_commission: 0,
  delivery_charge: 0,
  return_delivery_charge: 0,
  amount: -100,
  posting: {},
  items: [],
  services: [],
});

/** Отправление в форме клиента Ozon: оформлено `day`, статус Ozon `status`. */
const posting = (number: string, day: string, status = 'delivered'): IOzonPosting => ({
  postingNumber: number,
  orderNumber: number.split('-')[0],
  status,
  substatus: '',
  inProcessAt: `${day}T10:00:00Z`,
  products: [{ offerId: 'OF-1', quantity: 1, price: 2000, currency: 'RUB' }],
});

let test: ITestFinanceDb;

beforeAll(async () => {
  test = await createTestFinanceDb();
}, 60_000);

afterAll(async () => {
  await test?.close();
});

describe('Ozon → журнал finance_operations', () => {
  /** Что отдаст «Ozon» на следующий импорт. */
  let operations: Record<string, unknown>[];
  let fbs: IOzonPosting[];
  let catalog: () => Promise<unknown[]>;
  let credentials: Record<string, string> | null;
  let report: ReturnType<typeof vi.fn>;
  let ozon: OzonFinanceService;
  let operationsRepo: FinanceOperationRepository;

  beforeEach(async () => {
    await test.reset();
    operations = [sale(1), sale(2), storage(3)];
    fbs = [posting('P-1', '2026-09-10'), posting('P-2', '2026-08-25')];
    catalog = async () => [{ offerId: 'OF-1', sku: '900001', skus: ['900001', '900002'] }];
    credentials = { clientId: 'client-1', apiKey: 'SECRET' };
    report = vi.fn(async () => undefined);
    operationsRepo = new FinanceOperationRepository(test.db);

    const documents = new FinanceDocumentRepository(test.db);
    const actServices = new FinanceActServicesRepository(test.db);
    // Сверка — настоящая: правило ЯМ, заказы — отправления фейкового клиента.
    const reconciler = new FinanceReconcileService(
      {} as never,
      {} as never,
      documents,
      operationsRepo,
      new FinanceDiscrepancyRepository(test.db),
      actServices,
    );
    const imports = new FinanceImportService(
      {} as never,
      {} as never,
      documents,
      operationsRepo,
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      reconciler,
      // Аномалии — правила ЯМ: путь Ozon их не зовёт.
      { detectPeriod: vi.fn(() => Promise.reject(new Error('не для Ozon'))) } as never,
      actServices,
    );
    const client = {
      listFinanceOperations: vi.fn(async () => operations),
      listProducts: vi.fn(() => catalog()),
      listFbsPostings: vi.fn(async (since: Date, to: Date) =>
        fbs.filter((p) => {
          const at = Date.parse(p.inProcessAt);
          return at >= since.getTime() && at <= to.getTime();
        }),
      ),
      listFboPostings: vi.fn(async () => []),
    };
    ozon = new OzonFinanceService(
      { forCredentials: () => client } as never,
      { credentialsOf: async () => credentials } as never,
      {
        findByMarketplaceSkus: async () => [{ marketplaceSkus: { ozon: 'OF-1', ym: 'A1' } }],
      } as never,
      imports,
      { report } as never,
    );
  });

  const run = () => ozon.importPeriod(SELLER, SEPT, NOW);
  const rows = () =>
    test.db.select().from(financeOperations).where(eq(financeOperations.marketplace, 'ozon'));

  it('первая загрузка пишет операции; тот же ответ — unchanged, дублей нет', async () => {
    expect(await run()).toMatchObject({ status: 'imported', rows: 3, inserted: 3, unknown: 0 });
    const written = await rows();
    expect(written).toHaveLength(3);
    // SKU Ozon → offer_id → товар → артикул ЯМ: по нему ищется закуп.
    expect(
      written.filter((r) => r.transactionType.startsWith('OperationAgent')).map((r) => r.sku),
    ).toEqual(['A1', 'A1']);
    expect(written.every((r) => r.periodKey === OZON_KEY)).toBe(true);

    expect(await run()).toMatchObject({ status: 'unchanged', rows: 3 });
    expect(await rows()).toHaveLength(3);
  });

  it('пропавшая операция снимается, пересчитанная — корректировка «изменено»', async () => {
    await run();
    operations = [sale(1, { amount: 1690, sale_commission: -310 }), storage(3)];

    expect(await run()).toMatchObject({
      status: 'imported',
      inserted: 1,
      superseded: 2,
      changed: 1,
      removed: 1,
    });
    const live = (await rows()).filter((r) => !r.supersededAt);
    expect(live.map((r) => r.amountKopecks).sort((a, b) => a - b)).toEqual([-10000, 169000]);
    const corrections = await test.db.select().from(financeCorrections);
    expect(corrections.map((c) => [c.marketplace, c.kind]).sort()).toEqual([
      ['ozon', 'changed'],
      ['ozon', 'removed'],
    ]);
  });

  it('журнал ЯМ Ozon не видит: чтения по умолчанию — только ЯМ', async () => {
    await run();
    const from = new Date('2026-09-01T00:00:00+03:00');
    const to = new Date('2026-10-01T00:00:00+03:00');
    expect(await operationsRepo.liveForPnl(SELLER, from, to)).toEqual([]);
    expect(await operationsRepo.receivableByArticle(SELLER, to)).toEqual([]);
    expect(await operationsRepo.liveForPnl(SELLER, from, to, 'ozon')).not.toEqual([]);
  });

  const septStatus = async () => {
    const [state] = await test.db
      .select()
      .from(financePeriods)
      .where(and(eq(financePeriods.marketplace, 'ozon'), eq(financePeriods.periodKey, OZON_KEY)));
    return state;
  };

  it('статус периода — свой, по Ozon; без соседних месяцев не «Проверено»', async () => {
    await run();
    const state = await septStatus();
    expect(state).toMatchObject({ reportType: 'ozon-transaction-list', reconcileState: 'unchecked' });
    expect(state.reconcileNote).toMatch(/Нет отчёта прошлого и следующего месяца/);
    expect(state.status).not.toBe('verified');
  });

  describe('сверка с отправлениями (TASK-132)', () => {
    /** Август и октябрь загружены — соседи сентября есть. */
    const importNeighbours = async () => {
      operations.push(storage(10, '2026-08-20 00:00:00'), storage(11, '2026-10-05 00:00:00'));
      await ozon.importPeriod(SELLER, monthPeriod(2026, 8), NOW);
      await ozon.importPeriod(SELLER, monthPeriod(2026, 10), NOW);
    };
    const findings = () =>
      test.db
        .select()
        .from(financeDiscrepancies)
        .where(eq(financeDiscrepancies.marketplace, 'ozon'));

    it('всё сходится — «Проверено» без находок', async () => {
      await importNeighbours();
      await run();
      expect(await septStatus()).toMatchObject({ reconcileState: 'checked', discrepancyCount: 0 });
      expect(await findings()).toEqual([]);
    });

    it('выкуплен без продажи и начисление по чужому отправлению — находки Ozon', async () => {
      // P-3 выкуплен в сентябре, продажи нет; P-404 — начисление без отправления.
      fbs.push(posting('P-3', '2026-09-12'), posting('P-4', '2026-09-13', 'cancelled'));
      operations.push(sale(404, { amount: -50, accruals_for_sale: 0, sale_commission: -50 }));
      await importNeighbours();
      await run();

      const found = await findings();
      expect(found.map((f) => [f.kind, f.orderId]).sort()).toEqual([
        ['accrual_without_order', 'P-404'],
        ['delivered_without_accrual', 'P-3'],
      ]);
      expect(found.every((f) => f.periodKey === OZON_KEY)).toBe(true);
      expect(await septStatus()).toMatchObject({ reconcileState: 'checked', discrepancyCount: 2 });
    });
  });

  it('пустой месяц — empty, версии нет', async () => {
    operations = [];
    expect(await run()).toEqual({ status: 'empty', period: SEPT });
    expect(await rows()).toEqual([]);
  });

  it('нет ключа — отказ до записи статуса', async () => {
    credentials = null;
    await expect(run()).rejects.toBeInstanceOf(OzonNotConnectedError);
    expect(await test.db.select().from(financePeriods)).toEqual([]);
  });

  it('незнакомое — в журнал статьёй unknown и один алерт', async () => {
    operations = [sale(1, { services: [{ name: 'BrandNew', price: -5 }], amount: 1695 })];
    expect(await run()).toMatchObject({ status: 'imported', unknown: 1 });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: OZON_UNKNOWN_ARTICLE_CONTEXT }),
    );
  });

  it('каталог не ответил — сырой SKU и алерт; ответил позже — артикул дописан', async () => {
    catalog = () => Promise.reject(new Error('Ozon 503'));
    await run();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: OZON_FINANCE_SKU_CONTEXT }),
    );
    expect((await rows()).find((r) => r.orderId === 'P-1')?.sku).toBe('900001');

    catalog = async () => [{ offerId: 'OF-1', sku: '900001', skus: ['900001'] }];
    // Тот же ответ Ozon, но другие ключи закупа — новая версия, не unchanged.
    expect(await run()).toMatchObject({ status: 'imported', inserted: 0, superseded: 0 });
    expect((await rows()).find((r) => r.orderId === 'P-1')?.sku).toBe('A1');
  });

  it('P&L Ozon тем же движком: выручка, комиссия и закуп продажи — по разу', async () => {
    operations = [sale(1)];
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

    const ozonPnl = await finance.build(SELLER, SEPT, NOW, { marketplace: 'ozon' });
    // Прайс 1500 ₽ минус скидка по умолчанию 10 % (DEFAULT_RATES) — один раз, не на каждую статью.
    expect(ozonPnl.pnl.cogs.kopecks).toBe(135000);
    expect(ozonPnl.pnl.units).toBe(1);
    expect(ozonPnl.pnl.revenueKopecks).toBe(200000);
    expect(ozonPnl.pnl.marketplaceKopecks).toBe(-30000);
    expect(ozonPnl.pnl.ordersCount).toBe(1);
    expect(ozonPnl.pnl.salesByDay.reduce((sum, d) => sum + d.units, 0)).toBe(1);
    expect(ozonPnl.pnl.skus.skus.find((i) => i.sku === 'A1')).toMatchObject({ units: 1 });
    expect(ozonPnl.flat).toBeNull();
    expect(ozonPnl.flatNote).toBe(FLAT_YM_ONLY);
    expect(ozonPnl.months[0].status).not.toBeNull();

    // ЯМ по умолчанию журнала Ozon не видит.
    const ymPnl = await finance.build(SELLER, SEPT, NOW, { flat: false });
    expect(ymPnl.pnl.cogs.kopecks).toBe(0);
    expect(ymPnl.months[0].status).toBeNull();
  });
});

describe('ozonPurchaseKeys', () => {
  it('все SKU карточки → артикул ЯМ привязанного товара, иначе offer_id', () => {
    const keys = ozonPurchaseKeys(
      [
        { offerId: 'OF-1', sku: '1', skus: ['1', '2'] },
        { offerId: 'OF-2', sku: '3', skus: [] },
        { offerId: '', sku: '4', skus: ['4'] },
      ],
      new Map([['OF-1', 'A1']]),
    );
    expect(Object.fromEntries(keys)).toEqual({ '1': 'A1', '2': 'A1', '3': 'OF-2' });
  });
});
