import type { ICrmPnlView } from '../../src/modules/crm/finance/crm-finance.domain';
import type {
  ICrmOverviewCancelledView,
  ICrmOverviewStocksView,
  ICrmOverviewSummaryView,
} from '../../src/modules/crm/overview/crm-overview.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ymStockLevels } from '../../src/modules/marketplaces/marketplace-stocks';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import {
  parseDayRange,
  parseFinanceRangeParams,
} from '../../src/modules/crm/finance/crm-finance.domain';
import { CrmFinanceKinds } from '../../src/modules/crm/finance/crm-finance.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import {
  CANCELLED_RANGE_UNSUPPORTED_TEXT,
  OVERVIEW_CANCELLED_KIND,
  OVERVIEW_SERVICE_GROUP,
  OVERVIEW_STOCKS_KIND,
  OVERVIEW_SUMMARY_KIND,
  cancelledPeriodOf,
  stockValueOf,
} from '../../src/modules/crm/overview/crm-overview.domain';
import { CrmOverviewKinds } from '../../src/modules/crm/overview/crm-overview.kinds';
import { FINANCE_ARTICLE_KEYS } from '../../src/modules/finance/finance-articles';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { PNL_SECTION } from '../../src/modules/finance/pnl';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  FEATURE,
  FEATURE_KEYS,
  FEATURE_META,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { YandexDateRangeError } from '../../src/modules/yandex/yandex-date-window';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Обзор» CRM (TASK-125): карточки — из того же `FinanceService.build`, что
 * «Финансы», поэтому сверяются с `finance:pnl` до копейки; `finance:pnl`
 * принимает произвольный период; срезы Маркета — по магазинам кабинета.
 */

const SELLER = '222';
const SEPT = monthPeriod(2026, 9);
const AUG = monthPeriod(2026, 8);
const OCT_15 = new Date('2026-10-15T09:00:00Z');

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

const service = (orderId: number, name: string, sum: number) =>
  row({
    orderId,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: name,
    transactionSum: sum,
    count: null,
    actDate: '30.09.2026',
    paymentStatus: null,
    bankOrderId: null,
    bankOrderDate: null,
    bankSum: null,
  });

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let cashflow: FinanceCashflowService;
let finance: FinanceService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  const expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  cashflow = new FinanceCashflowService(
    operations,
    expenses,
    new FinancePurchasesService(new FinancePurchaseRepository(pg.db)),
  );
  finance = new FinanceService(
    operations,
    new FinancePeriodRepository(pg.db),
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    expenses,
    { findByTelegramUser: async () => null } as never,
    { findBySkus: async () => new Map([['A1', { price: 1500 }]]) } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function seed(rows: Record<string, unknown>[], period = SEPT) {
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: period.from,
    periodTo: period.to,
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
        periodKey: financePeriodKey('united-netting', period),
      }),
    ),
  );
}

const contextOf = (params: Record<string, unknown>, store: unknown = {}, features = {}) =>
  ({ telegramUserId: SELLER, store: store as never, params, features }) as const;

function overviewKinds(over: Partial<Record<string, unknown>> = {}) {
  return new CrmOverviewKinds(
    { register: vi.fn() } as never,
    finance,
    cashflow,
    (over.marketplaces ?? {}) as never,
    (over.reports ?? {}) as never,
    (over.purchasePrices ?? {}) as never,
  );
}

describe('сводка «Обзора» = «Финансам» по построению', () => {
  beforeEach(async () => {
    await pg.reset();
  });

  it('уровни сентября совпадают с finance:pnl до копейки; заказы, штуки, средний чек', async () => {
    await seed([
      row(),
      row({ orderId: 2, count: 1, transactionSum: 2500 }),
      service(1, 'Доставка покупателю', -200),
      service(2, 'Размещение товарных предложений', -300.25),
      service(2, 'Буст продаж, оплата за продажи', -100),
    ]);
    await seed([row({ orderId: 7, transactionDate: '10.08.2026 10:00' })], AUG);

    const pnl = await new CrmFinanceKinds({ register: vi.fn() } as never, finance).run(
      contextOf({ month: '2026-09' }),
      OCT_15,
    );
    const { data } = await overviewKinds().summary(
      contextOf({ from: SEPT.from, to: SEPT.to, prevFrom: AUG.from, prevTo: AUG.to }),
      OCT_15,
    );
    const view = data as ICrmOverviewSummaryView;

    expect(view.current.levels).toEqual((pnl.data as ICrmPnlView).levels);
    expect(view.current).toMatchObject({
      from: SEPT.from,
      to: SEPT.to,
      ordersCount: 2,
      units: 3,
      salesKopecks: 750_000,
      avgCheckKopecks: 375_000,
    });
    expect(view.current.services.logistics).toBe(-20_000);
    expect(view.current.services.commission).toBe(-30_025);
    expect(view.current.services.promotion).toBe(-10_000);
    const servicesSum = Object.values(view.current.services).reduce((s, v) => s + v, 0);
    expect(servicesSum).toBe(view.current.levels.marketplaceKopecks);

    expect(view.previous).toMatchObject({ from: AUG.from, ordersCount: 1, salesKopecks: 500_000 });
    // К получению — тем же методом, что вкладка ДДС.
    const ddc = await cashflow.build(SELLER, SEPT, OCT_15);
    expect(view.receivable).toEqual({
      asOf: ddc.receivable.asOf,
      totalKopecks: ddc.receivable.totalKopecks,
      operationCount: ddc.receivable.operationCount,
    });
    expect(view.receivable.totalKopecks).toBe(-60_025);
    // Раскрытие живёт в «Финансах» — сводка id операций не несёт.
    expect(JSON.stringify(view)).not.toContain('operationIds');
  });

  it('finance:pnl с from/to на целом месяце = finance:pnl по месяцу, эхо — без месяца', async () => {
    await seed([row(), service(1, 'Доставка покупателю', -200)]);
    const kinds = new CrmFinanceKinds({ register: vi.fn() } as never, finance);
    const byMonth = (await kinds.run(contextOf({ month: '2026-09' }), OCT_15)).data as ICrmPnlView;
    const byRange = (await kinds.run(contextOf({ from: SEPT.from, to: SEPT.to }), OCT_15))
      .data as ICrmPnlView;
    expect(byRange.levels).toEqual(byMonth.levels);
    expect(byRange.sections).toEqual(byMonth.sections);
    expect(byRange).toMatchObject({ month: null, from: SEPT.from, to: SEPT.to });

    const week = (await kinds.run(contextOf({ from: '2026-09-14', to: '2026-09-20' }), OCT_15))
      .data as ICrmPnlView;
    expect(week.levels.revenueKopecks).toBe(500_000);
    await expect(
      kinds.run(contextOf({ from: '2026-09-31', to: '2026-10-01' }), OCT_15),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('сводка без прошлого периода или с мусором — понятный отказ', async () => {
    await expect(
      overviewKinds().summary(contextOf({ from: SEPT.from, to: SEPT.to }), OCT_15),
    ).rejects.toBeInstanceOf(CrmJobError);
  });
});

describe('разбор периода', () => {
  it('настоящие даты, не задом наперёд, не длиннее года', () => {
    expect(parseDayRange('2026-09-01', '2026-09-30')).toEqual(SEPT);
    expect(parseDayRange('2026-02-29', '2026-03-01')).toBeNull();
    expect(parseDayRange('2026-09-30', '2026-09-01')).toBeNull();
    expect(parseDayRange('2025-01-01', '2026-01-02')).toBeNull();
    expect(parseDayRange('2025-01-01', '2026-01-01')).not.toBeNull();
    expect(parseDayRange(20260901, '2026-09-30')).toBeNull();
  });

  it('месяц важнее диапазона, мусорный месяц — null', () => {
    expect(parseFinanceRangeParams({ month: '2026-09', from: 'x' })).toEqual({
      month: '2026-09',
      period: SEPT,
    });
    expect(parseFinanceRangeParams({ month: '09-2026' })).toBeNull();
    expect(parseFinanceRangeParams({})).toBeNull();
  });
});

describe('группы услуг', () => {
  it('в группы идут ровно расходы площадки', () => {
    for (const key of FINANCE_ARTICLE_KEYS) {
      expect(OVERVIEW_SERVICE_GROUP[key] !== null, key).toBe(PNL_SECTION[key] === 'marketplace');
    }
  });
});

describe('стоимость остатков', () => {
  it('по текущему закупу; без закупа — счётчиком, не нулём', () => {
    const costs = new Map([
      ['A', 1000.555],
      ['B', 50],
    ]);
    expect(stockValueOf({ A: 2, B: 1, C: 3, D: 0 }, costs)).toEqual({
      kopecks: 100_056 * 2 + 5_000,
      units: 6,
      withoutCost: { skus: 1, units: 3 },
    });
  });

  it('kind обходит все магазины кабинета; сбой магазина — причина, а не ноль', async () => {
    const doc = {
      telegramUserId: SELLER,
      campaign_id: '1',
      business_id: 'b1',
      name: 'Первый',
      stores: [
        { campaignId: '1', businessId: 'b1', storeName: 'Первый' },
        { campaignId: '2', businessId: 'b1', storeName: 'Второй' },
      ],
    };
    const listStocks = vi
      .fn()
      .mockResolvedValueOnce(
        ymStockLevels({ placement: 'FBS', takenAt: new Date(), stocks: { A1: 3, X: 1 } }),
      )
      .mockRejectedValueOnce(new Error('boom'));
    const build = vi.fn().mockResolvedValue({
      count: 2,
      totals: { sales: 1234.5 },
      orders: [{ items: [{ count: 2 }] }, { items: [{ count: 1 }, {}] }],
    });
    const kinds = overviewKinds({
      marketplaces: { require: () => ({ listStocks }) },
      reports: { build },
      purchasePrices: { findBySkus: async () => new Map([['A1', { price: 1000 }]]) },
    });

    const view = (await kinds.stocks(contextOf({}, doc), OCT_15)).data as ICrmOverviewStocksView;
    expect(view.stores).toBe(2);
    // 1000 ₽ минус общая скидка 10 % = 900 ₽ × 3.
    expect(view.stockValueKopecks).toBe(270_000);
    expect(view.withoutCost).toEqual({ skus: 1, units: 1 });
    expect(view.inTransit).toEqual({ orders: 2, units: 3, salesKopecks: 123_450 });
    expect(view.problems).toEqual([{ storeName: 'Второй', problem: expect.any(String) }]);
    // Через реестр площадок: магазин — кампанией, документ адаптер читает сам.
    expect(listStocks).toHaveBeenNthCalledWith(
      1,
      { telegramUserId: SELLER, marketplace: 'ym', campaignId: '1' },
      OCT_15,
    );

    const closed = (
      await kinds.stocks(contextOf({}, doc, { [FEATURE.REPORT_IN_TRANSIT]: false }), OCT_15)
    ).data as ICrmOverviewStocksView;
    expect(closed.inTransit).toBeNull();
  });
});

describe('отмены', () => {
  const today = '2026-10-15';

  it('период отчётов о заказах — только тот, что они умеют', () => {
    expect(cancelledPeriodOf({ from: today, to: today }, today)).toEqual({ key: PERIOD.TODAY });
    expect(cancelledPeriodOf({ from: '2026-10-14', to: '2026-10-14' }, today)).toEqual({
      key: PERIOD.DAY,
      day: { year: 2026, month: 10, day: 14 },
    });
    expect(cancelledPeriodOf({ from: '2026-10-01', to: today }, today)).toEqual({
      key: PERIOD.MONTH,
    });
    expect(cancelledPeriodOf(SEPT, today)).toBeNull();
  });

  it('неподдержанный период — null с причиной; глубокий день — текст ошибки', async () => {
    const params = { from: SEPT.from, to: SEPT.to, prevFrom: AUG.from, prevTo: AUG.to };
    const view = (await overviewKinds().cancelled(contextOf(params, {}), OCT_15))
      .data as ICrmOverviewCancelledView;
    expect(view).toMatchObject({ count: null, note: CANCELLED_RANGE_UNSUPPORTED_TEXT });

    const deep = overviewKinds({
      reports: {
        collectPlacedOrders: vi.fn().mockRejectedValue(new YandexDateRangeError('слишком давно')),
      },
    });
    const day = {
      from: '2026-07-01',
      to: '2026-07-01',
      prevFrom: '2026-06-30',
      prevTo: '2026-06-30',
    };
    const refused = (await deep.cancelled(contextOf(day, { telegramUserId: SELLER }), OCT_15))
      .data as ICrmOverviewCancelledView;
    expect(refused.count).toBeNull();
    expect(refused.note).toBeTruthy();

    const ok = overviewKinds({
      reports: {
        collectPlacedOrders: vi.fn().mockResolvedValue({ orders: [], cancelled: [{}, {}] }),
      },
    });
    const month = { from: '2026-10-01', to: today, prevFrom: SEPT.from, prevTo: '2026-09-15' };
    const counted = (await ok.cancelled(contextOf(month, { telegramUserId: SELLER }), OCT_15))
      .data as ICrmOverviewCancelledView;
    expect(counted).toMatchObject({ count: 2, note: null, stores: 1 });
  });
});

describe('фича и гейт', () => {
  it('overview — выключена по умолчанию, раздел аккаунта под ней', () => {
    expect(FEATURE_KEYS).toContain(FEATURE.OVERVIEW);
    expect(FEATURE_META[FEATURE.OVERVIEW].defaultEnabled).toBe(false);
    expect(CRM_SECTIONS['ym-overview']).toEqual([FEATURE.OVERVIEW]);
  });

  it('деньги — только вместе с «Финансами»; срезы Маркета — под overview', () => {
    const register = vi.fn();
    const kinds = new CrmOverviewKinds(
      { register } as never,
      finance,
      cashflow,
      {} as never,
      {} as never,
      {} as never,
    );
    kinds.onModuleInit();
    const byKind = Object.fromEntries(register.mock.calls.map(([kind, def]) => [kind, def]));
    expect(byKind[OVERVIEW_SUMMARY_KIND]).toMatchObject({
      features: [FEATURE.OVERVIEW, FEATURE.FINANCE],
      scope: 'account',
    });
    expect(byKind[OVERVIEW_STOCKS_KIND].features).toEqual([FEATURE.OVERVIEW]);
    expect(byKind[OVERVIEW_CANCELLED_KIND].features).toEqual([FEATURE.OVERVIEW]);
  });
});
