import type { ICrmReturnsAnalytics } from '../../src/modules/crm/returns-analytics/crm-returns-analytics.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { RETURNS_ANALYTICS_KIND } from '../../src/modules/crm/returns-analytics/crm-returns-analytics.domain';
import { CrmReturnsAnalyticsKinds } from '../../src/modules/crm/returns-analytics/crm-returns-analytics.kinds';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { ReturnsAnalyticsService } from '../../src/modules/finance/returns-analytics.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  FEATURE,
  FEATURE_META,
  isFeatureEnabled,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Аналитика возвратов» CRM (TASK-145): деньги — те же строки журнала, что у
 * «Финансов», поэтому суммы статей сверяются с `byArticle` P&L до копейки;
 * комиссия возвращённого заказа читается и за прошлый месяц.
 */

const SELLER = '333';
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
  model: 'FBS',
  ...over,
});

const service = (orderId: number | null, type: string, name: string, sum: number, date: string) =>
  row({
    orderId,
    shopSku: null,
    transactionType: type,
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: name,
    transactionSum: sum,
    transactionDate: date,
    count: null,
    paymentStatus: null,
    bankOrderId: null,
    bankOrderDate: null,
    bankSum: null,
  });

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let finance: FinanceService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  finance = new FinanceService(
    operations,
    new FinancePeriodRepository(pg.db),
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    new FinanceExpensesService(new FinanceExpenseRepository(pg.db)),
    { findByTelegramUser: async () => null } as never,
    { findBySkus: async () => new Map() } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
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

const PRODUCTS = [{ marketplaceSkus: { ym: 'A1' }, name: 'Casio G-Shock GA-2100' }];

function kinds() {
  const returns = new ReturnsAnalyticsService(operations, {
    findByYmSkus: async () => PRODUCTS,
  } as never);
  return new CrmReturnsAnalyticsKinds({ register: vi.fn() } as never, returns);
}

const contextOf = (params: Record<string, unknown>, features: Record<string, boolean> = {}) =>
  ({ telegramUserId: SELLER, store: {} as never, params, features }) as const;

async function seedMonths() {
  // Август: продажа заказа 7 и её комиссия.
  await seed(
    [
      row({ orderId: 7, count: 1, transactionSum: 4000, transactionDate: '20.08.2026 10:00' }),
      service(7, 'Удержание', 'Размещение товарных предложений', -400, '20.08.2026 10:00'),
    ],
    AUG,
  );
  // Сентябрь: продажа заказа 1, возврат заказа 7 со всеми хвостами.
  await seed([
    row(),
    row({
      orderId: 7,
      transactionType: 'Возврат',
      transactionSource: 'Возврат платежа покупателя',
      count: 1,
      transactionSum: -4000,
      transactionDate: '12.09.2026 10:00',
    }),
    row({
      orderId: 7,
      transactionType: 'Возврат',
      transactionSource: 'Возврат баллов за скидку Маркета',
      count: 1,
      transactionSum: -100,
      transactionDate: '12.09.2026 10:00',
    }),
    service(7, 'Начисление', 'Возврат за размещение товаров на витрине', 150, '12.09.2026 10:00'),
    service(7, 'Удержание', 'Доставка невыкупов и возвратов', -250, '13.09.2026 10:00'),
    row({
      orderId: 7,
      shopSku: null,
      transactionType: 'Начисление',
      transactionSource: 'Утеря или порча отправления заказа',
      count: null,
      transactionSum: 80,
      transactionDate: '14.09.2026 10:00',
    }),
  ]);
}

describe('«Аналитика возвратов» — из того же журнала, что «Финансы»', () => {
  it('суммы статей = byArticle P&L, комиссия заказа — нетто за все даты', async () => {
    await seedMonths();
    const pnl = (await finance.build(SELLER, SEPT, OCT_15, { flat: false })).pnl;
    const { data } = await kinds().summary(contextOf({ from: SEPT.from, to: SEPT.to }));
    const view = data as ICrmReturnsAnalytics;

    expect(view.marketplaces.map((m) => [m.marketplace, m.label])).toEqual([['ym', 'Яндекс Маркет']]);
    const ym = view.marketplaces[0];
    expect(ym.totals.returnedAmountKopecks).toBe(-pnl.byArticle.returns.kopecks);
    expect(ym.totals.reverseLogisticsKopecks).toBe(-pnl.byArticle.reverse_logistics.kopecks);
    expect(ym.totals.compensationsKopecks).toBe(pnl.byArticle.compensations.kopecks);
    expect(ym.totals.returnedAmountKopecks).toBe(410_000);
    expect(ym.totals).toMatchObject({
      returnedUnits: 1,
      returnedOrders: 1,
      soldUnits: 2,
      returnRate: 0.5,
      reverseLogisticsKopecks: 25_000,
      compensationsKopecks: 8_000,
      // Августовская комиссия 400 ₽ минус возвращённые в сентябре 150 ₽.
      unreturnedCommissionKopecks: 25_000,
      lossesKopecks: 25_000 + 25_000 - 8_000,
    });
    expect(ym.skus.map((s) => [s.sku, s.brand])).toEqual([['A1', 'casio']]);
    expect(view.period).toEqual(SEPT);
  });

  it('площадки — только открытые продавцу, каждая своим блоком', async () => {
    const view = (await kinds().summary(
      contextOf({ from: SEPT.from, to: SEPT.to }, { [FEATURE.WB]: true }),
    )).data as ICrmReturnsAnalytics;
    expect(view.marketplaces.map((m) => m.marketplace)).toEqual(['ym', 'wb']);
  });

  it('кривой период — понятный отказ продавцу, а не сбой', async () => {
    await expect(
      kinds().summary(contextOf({ from: '2026-09-30', to: '2026-09-01' })),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('kind под returns_analytics, раздел аккаунта открыт фичей; фича выключена и требует finance', () => {
    const register = vi.fn();
    new CrmReturnsAnalyticsKinds({ register } as never, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      RETURNS_ANALYTICS_KIND,
      expect.objectContaining({ features: [FEATURE.RETURNS_ANALYTICS], scope: 'account' }),
    );
    expect(CRM_SECTIONS['ym-returns-analytics']).toEqual([FEATURE.RETURNS_ANALYTICS]);
    expect(FEATURE_META[FEATURE.RETURNS_ANALYTICS].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.RETURNS_ANALYTICS].requires).toEqual([FEATURE.FINANCE]);
    expect(isFeatureEnabled({ [FEATURE.RETURNS_ANALYTICS]: true }, FEATURE.RETURNS_ANALYTICS)).toBe(
      false,
    );
  });
});
