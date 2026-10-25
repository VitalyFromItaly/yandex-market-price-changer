import type { ICrmPnlView } from '../../src/modules/crm/finance/crm-finance.domain';
import type { ICrmSalesAnalytics } from '../../src/modules/crm/sales-analytics/crm-sales-analytics.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import { CrmFinanceKinds } from '../../src/modules/crm/finance/crm-finance.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { SALES_ANALYTICS_KIND } from '../../src/modules/crm/sales-analytics/crm-sales-analytics.domain';
import { CrmSalesAnalyticsKinds } from '../../src/modules/crm/sales-analytics/crm-sales-analytics.kinds';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  FEATURE,
  FEATURE_META,
  isFeatureEnabled,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Аналитика продаж» CRM (TASK-140): разрезы того же P&L, что «Финансы», поэтому
 * Σ любого разреза сверяется с выручкой `finance:pnl` до копейки.
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
  model: 'FBS',
  ...over,
});

const service = (orderId: number | null, name: string, sum: number) =>
  row({
    orderId,
    shopSku: null,
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
    // Закуп есть только у A1: у B2 себестоимость не подтверждена.
    { findBySkus: async () => new Map([['A1', { price: 1500 }]]) } as never,
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

async function seed(
  rows: Record<string, unknown>[],
  period = SEPT,
  marketplace: 'ym' | 'ozon' = 'ym',
) {
  const reportType = marketplace === 'ym' ? 'united-netting' : 'ozon-transaction-list';
  const { document } = await documents.registerVersion({
    marketplace,
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType,
    periodFrom: period.from,
    periodTo: period.to,
    buffer: Buffer.from(JSON.stringify(rows)),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  const keys = journalKeys(rows);
  await operations.upsertMany(
    // Ozon — те же строки под своей площадкой: экрану важна площадка журнала, не формат отчёта.
    rows.map((r, i) => ({
      ...nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: financePeriodKey(reportType, period),
      }),
      marketplace,
    })),
  );
}

const contextOf = (params: Record<string, unknown>) =>
  ({ telegramUserId: SELLER, store: {} as never, params, features: {} }) as const;

type TProduct = {
  marketplaceSkus: Partial<Record<'ym' | 'ozon', string>>;
  name: string;
  category?: string;
};

function kinds(products: TProduct[] = []) {
  return new CrmSalesAnalyticsKinds({ register: vi.fn() } as never, finance, {
    // Как `ProductService.findByJournalSkus`: сначала артикул ЯМ, затем артикул площадки.
    findByJournalSkus: async (_uid: string, marketplace: 'ym' | 'ozon', skus: string[]) =>
      new Map(
        skus.flatMap((sku) => {
          const found =
            products.find((p) => p.marketplaceSkus.ym === sku) ??
            (marketplace === 'ym'
              ? undefined
              : products.find((p) => p.marketplaceSkus[marketplace] === sku));
          return found ? [[sku, found] as const] : [];
        }),
      ),
  } as never);
}

const SEPT_PARAMS = { from: SEPT.from, to: SEPT.to, prevFrom: AUG.from, prevTo: AUG.to };

const PRODUCTS: TProduct[] = [
  { marketplaceSkus: { ym: 'A1' }, name: 'Casio G-Shock GA-2100' },
  { marketplaceSkus: { ym: 'B2' }, name: 'Амфибия 420', category: 'Наручные часы' },
  { marketplaceSkus: { ym: 'C3' }, name: 'Romanson TM' },
  { marketplaceSkus: { ym: 'D4' }, name: 'Casio Edifice' },
];

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

describe('«Аналитика продаж» = «Финансам» по построению', () => {
  async function seedSept() {
    await seed([
      row(),
      row({ orderId: 2, shopSku: 'B2', count: 1, transactionSum: 2500.33, transactionDate: '17.09.2026 10:00' }),
      row({ orderId: 3, shopSku: 'C3', count: 1, transactionSum: 1999.99, transactionDate: '17.09.2026 11:00' }),
      // Заказ 4 — два артикула CASIO, продажи в разные дни.
      row({ orderId: 4, shopSku: 'D4', count: 1, transactionSum: 4000, transactionDate: '20.09.2026 12:00' }),
      row({ orderId: 4, shopSku: 'A1', count: 1, transactionSum: 2500, transactionDate: '21.09.2026 12:00' }),
      // Возврат одной штуки A1.
      row({
        orderId: 1,
        transactionSource: 'Возврат платежа покупателя',
        transactionType: 'Возврат',
        count: 1,
        transactionSum: -2500,
        transactionDate: '25.09.2026 09:00',
      }),
      service(1, 'Размещение товарных предложений', -1150.17),
      service(null, 'Подписка', -169.9),
    ]);
    await seed(
      [row({ orderId: 7, shopSku: 'B2', transactionDate: '10.08.2026 10:00', transactionSum: 3000 })],
      AUG,
    );
  }

  it('продажи по брендам, товарам, дням и площадкам за месяц = выручке finance:pnl', async () => {
    await seedSept();
    const pnl = await new CrmFinanceKinds({ register: vi.fn() } as never, finance).run(
      contextOf({ month: '2026-09' }),
      OCT_15,
    );
    const revenue = (pnl.data as ICrmPnlView).levels.revenueKopecks;
    const { data } = await kinds(PRODUCTS).summary(contextOf(SEPT_PARAMS), OCT_15);
    const view = data as ICrmSalesAnalytics;

    expect(view.totals.revenueKopecks).toBe(revenue);
    // Шаг 1 test_steps: продажи по брендам за месяц совпадают с итогом.
    expect(sum(view.brands, (b) => b.revenueKopecks) + view.rest.revenueKopecks).toBe(revenue);
    expect(sum(view.skus, (s) => s.revenueKopecks) + view.rest.revenueKopecks).toBe(revenue);
    expect(sum(view.days, (d) => d.revenueKopecks)).toBe(revenue);
    expect(sum(view.marketplaces, (m) => m.revenueKopecks)).toBe(revenue);

    expect(sum(view.brands, (b) => b.units) + view.rest.units).toBe(view.totals.units);
    expect(sum(view.days, (d) => d.units)).toBe(view.totals.units);
    // Заказ 4 начат 20-го и продолжен 21-го — в дни он идёт один раз.
    expect(sum(view.days, (d) => d.orders)).toBe(view.totals.orders);
    expect(view.totals.orders).toBe(4);
    expect(view.totals.units).toBe(2 + 1 + 1 + 1 + 1 - 1);

    expect(view.brands.map((b) => [b.key, b.title, b.skus])).toEqual([
      ['vostok', 'Восток', 1],
      ['casio', 'CASIO', 2],
      [null, 'Остальные', 1],
    ]);
    const casio = view.brands.find((b) => b.key === 'casio');
    expect(casio?.revenueKopecks).toBe(500_000 + 250_000 - 250_000 + 400_000);
    expect(view.marketplaces).toEqual([
      expect.objectContaining({ marketplace: 'ym', label: 'Яндекс Маркет', revenueKopecks: revenue }),
    ]);
    expect(view.periodDays).toBe(30);
    expect(view.totals.avgCheckKopecks).toBe(Math.round(revenue / 4));
    expect(view.totals.unitsPerDay).toBeCloseTo(5 / 30);
    expect(view.period).toEqual(SEPT);
    expect(view.previousPeriod).toEqual(AUG);
  });

  it('динамика: строка сравнивается со своей строкой прошлого периода', async () => {
    await seedSept();
    const { data } = await kinds(PRODUCTS).summary(contextOf(SEPT_PARAMS), OCT_15);
    const view = data as ICrmSalesAnalytics;

    expect(view.previousTotals).toMatchObject({ revenueKopecks: 300_000, units: 2, orders: 1 });
    expect(view.skus.find((s) => s.sku === 'B2')?.previous).toEqual({ revenueKopecks: 300_000, units: 2 });
    expect(view.skus.find((s) => s.sku === 'C3')?.previous).toBeNull();
    expect(view.brands.find((b) => b.key === 'vostok')?.previous).toEqual({
      revenueKopecks: 300_000,
      units: 2,
    });
    expect(view.brands.find((b) => b.key === 'casio')?.previous).toBeNull();
  });

  it('площадка (TASK-181): Ozon — свой журнал и свои артикулы, ЯМ не изменился', async () => {
    await seed([row()]);
    const products: TProduct[] = [
      { marketplaceSkus: { ym: 'A1' }, name: 'Часы ЯМ' },
      { marketplaceSkus: { ozon: 'B2' }, name: 'Часы Ozon' },
    ];
    const ymBefore = (await kinds(products).summary(contextOf(SEPT_PARAMS), OCT_15))
      .data as ICrmSalesAnalytics;

    await seed([row({ orderId: 2, shopSku: 'B2', count: 1, transactionSum: 2500 })], SEPT, 'ozon');
    const ozonContext = {
      ...contextOf({ ...SEPT_PARAMS, marketplace: 'ozon' }),
      features: { [FEATURE.OZON]: true },
    };
    const ym = (await kinds(products).summary(contextOf(SEPT_PARAMS), OCT_15)).data as ICrmSalesAnalytics;
    const ozon = (await kinds(products).summary(ozonContext, OCT_15)).data as ICrmSalesAnalytics;

    expect(ym).toEqual(ymBefore);
    expect([ym.marketplace, ozon.marketplace]).toEqual(['ym', 'ozon']);
    expect(ozon.skus.map((s) => [s.sku, s.name])).toEqual([['B2', 'Часы Ozon']]);
    expect(ym.skus.map((s) => [s.sku, s.name])).toEqual([['A1', 'Часы ЯМ']]);
    // Экраны площадок складываются в общий итог: каждая — ровно выручка своего журнала.
    const revenueOf = (view: ICrmSalesAnalytics) => view.totals.revenueKopecks;
    expect(revenueOf(ym)).toBe(500_000);
    expect(revenueOf(ozon)).toBe(250_000);
    expect(ozon.marketplaces.map((m) => [m.marketplace, m.label, m.revenueKopecks])).toEqual([
      ['ozon', 'Ozon', 250_000],
    ]);
  });

  it('площадка: мусор и закрытая фича — отказ, а не тихий ЯМ', async () => {
    await expect(
      kinds().summary(contextOf({ ...SEPT_PARAMS, marketplace: 'amazon' })),
    ).rejects.toBeInstanceOf(CrmJobError);
    await expect(
      kinds().summary(contextOf({ ...SEPT_PARAMS, marketplace: 'ozon' })),
    ).rejects.toThrow('«Ozon» закрыта');
  });

  it('кривой период — понятный отказ продавцу, а не сбой', async () => {
    await expect(
      kinds().summary(contextOf({ from: '2026-09-30', to: '2026-09-01' })),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('kind под sales_analytics, раздел аккаунта открыт фичей; фича выключена и требует finance', () => {
    const register = vi.fn();
    new CrmSalesAnalyticsKinds({ register } as never, finance, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      SALES_ANALYTICS_KIND,
      expect.objectContaining({ features: [FEATURE.SALES_ANALYTICS], scope: 'account' }),
    );
    expect(CRM_SECTIONS['ym-sales-analytics']).toEqual([FEATURE.SALES_ANALYTICS]);
    expect(FEATURE_META[FEATURE.SALES_ANALYTICS].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.SALES_ANALYTICS].requires).toEqual([FEATURE.FINANCE]);
    expect(isFeatureEnabled({ [FEATURE.SALES_ANALYTICS]: true }, FEATURE.SALES_ANALYTICS)).toBe(false);
    expect(
      isFeatureEnabled(
        { [FEATURE.SALES_ANALYTICS]: true, [FEATURE.FINANCE]: true },
        FEATURE.SALES_ANALYTICS,
      ),
    ).toBe(true);
  });
});
