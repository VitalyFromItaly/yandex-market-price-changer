import type { ICrmPnlView } from '../../src/modules/crm/finance/crm-finance.domain';
import type { ICrmSkuRatings } from '../../src/modules/crm/sku-ratings/crm-sku-ratings.domain';
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
import { SKU_RATINGS_KIND } from '../../src/modules/crm/sku-ratings/crm-sku-ratings.domain';
import { CrmSkuRatingsKinds } from '../../src/modules/crm/sku-ratings/crm-sku-ratings.kinds';
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
 * «Рейтинги и классификации» CRM (TASK-141): ТОП-листы и ABC над тем же P&L, что
 * «Финансы», поэтому выручка товаров сверяется с `finance:pnl` до копейки.
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
  return new CrmSkuRatingsKinds({ register: vi.fn() } as never, finance, {
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


describe('«Рейтинги» = «Финансам» по построению', () => {
  async function seedSept() {
    await seed([
      // A1 — по штуке каждую неделю сентября (закуп есть).
      row({ orderId: 1, count: 1, transactionDate: '01.09.2026 10:00' }),
      row({ orderId: 2, count: 1, transactionDate: '08.09.2026 10:00' }),
      row({ orderId: 3, count: 1, transactionDate: '15.09.2026 10:00' }),
      row({ orderId: 4, count: 1, transactionDate: '22.09.2026 10:00' }),
      // B2 — закупа нет: в рейтинги прибыли не входит.
      row({ orderId: 5, shopSku: 'B2', count: 1, transactionSum: 9000, transactionDate: '17.09.2026 10:00' }),
      row({ orderId: 6, shopSku: 'C3', count: 1, transactionSum: 1999.99, transactionDate: '17.09.2026 11:00' }),
      service(1, 'Размещение товарных предложений', -1150.17),
      service(null, 'Подписка', -169.9),
    ]);
    await seed(
      [
        row({ orderId: 7, shopSku: 'D4', count: 3, transactionDate: '10.08.2026 10:00' }),
        row({ orderId: 8, count: 1, transactionDate: '11.08.2026 10:00' }),
      ],
      AUG,
    );
  }

  it('выручка товаров = finance:pnl, ТОП и классы из того же разреза', async () => {
    await seedSept();
    const pnl = await new CrmFinanceKinds({ register: vi.fn() } as never, finance).run(
      contextOf({ month: '2026-09' }),
      OCT_15,
    );
    const revenue = (pnl.data as ICrmPnlView).levels.revenueKopecks;
    const { data } = await kinds(PRODUCTS).summary(contextOf(SEPT_PARAMS), OCT_15);
    const view = data as ICrmSkuRatings;

    // Все продажи здесь с артикулом: Σ товаров = выручке периода.
    expect(view.skus.reduce((s, r) => s + r.revenueKopecks, 0)).toBe(revenue);
    expect(view.abcRevenue.reduce((s, c) => s + c.kopecks, 0)).toBe(revenue);
    expect(view.period).toEqual(SEPT);
    expect(view.previousPeriod).toEqual(AUG);
    expect(view.thresholds.abc).toEqual({ a: 0.8, b: 0.95 });

    const top = (key: string) => view.tops.find((t) => t.key === key)?.rows.map((r) => r.sku);
    expect(top('revenue')).toEqual(['A1', 'B2', 'C3']);
    expect(top('net')).not.toContain('B2');
    expect(view.skus.find((r) => r.sku === 'B2')).toMatchObject({
      costKnown: false,
      abcProfit: null,
      abcProfitReason: 'нет закупа',
    });
    expect(top('falling')).toEqual(['D4']);
    expect(view.skus.find((r) => r.sku === 'A1')).toMatchObject({
      name: 'Casio G-Shock GA-2100',
      units: 4,
      previousUnits: 1,
      weeklyUnits: [1, 1, 1, 1],
      xyz: 'X',
    });
    expect(view.weeks).toBe(4);
  });

  it('площадка (TASK-181): Ozon — свой журнал и свои артикулы, ЯМ не изменился', async () => {
    await seed([row()]);
    const products: TProduct[] = [
      { marketplaceSkus: { ym: 'A1' }, name: 'Часы ЯМ' },
      { marketplaceSkus: { ozon: 'B2' }, name: 'Часы Ozon' },
    ];
    const ymBefore = (await kinds(products).summary(contextOf(SEPT_PARAMS), OCT_15))
      .data as ICrmSkuRatings;

    await seed([row({ orderId: 2, shopSku: 'B2', count: 1, transactionSum: 2500 })], SEPT, 'ozon');
    const ozonContext = {
      ...contextOf({ ...SEPT_PARAMS, marketplace: 'ozon' }),
      features: { [FEATURE.OZON]: true },
    };
    const ym = (await kinds(products).summary(contextOf(SEPT_PARAMS), OCT_15)).data as ICrmSkuRatings;
    const ozon = (await kinds(products).summary(ozonContext, OCT_15)).data as ICrmSkuRatings;

    expect(ym).toEqual(ymBefore);
    expect([ym.marketplace, ozon.marketplace]).toEqual(['ym', 'ozon']);
    expect(ozon.skus.map((s) => [s.sku, s.name])).toEqual([['B2', 'Часы Ozon']]);
    expect(ym.skus.map((s) => [s.sku, s.name])).toEqual([['A1', 'Часы ЯМ']]);
    // Экраны площадок складываются в общий итог: каждая — ровно выручка своего журнала.
    const revenueOf = (view: ICrmSkuRatings) => view.skus.reduce((s, r) => s + r.revenueKopecks, 0);
    expect(revenueOf(ym)).toBe(500_000);
    expect(revenueOf(ozon)).toBe(250_000);
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

  it('kind под sku_ratings, раздел аккаунта открыт фичей; фича выключена и требует finance', () => {
    const register = vi.fn();
    new CrmSkuRatingsKinds({ register } as never, finance, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      SKU_RATINGS_KIND,
      expect.objectContaining({ features: [FEATURE.SKU_RATINGS], scope: 'account' }),
    );
    expect(CRM_SECTIONS['ym-sku-ratings']).toEqual([FEATURE.SKU_RATINGS]);
    expect(FEATURE_META[FEATURE.SKU_RATINGS].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.SKU_RATINGS].requires).toEqual([FEATURE.FINANCE]);
    expect(isFeatureEnabled({ [FEATURE.SKU_RATINGS]: true }, FEATURE.SKU_RATINGS)).toBe(false);
    expect(
      isFeatureEnabled({ [FEATURE.SKU_RATINGS]: true, [FEATURE.FINANCE]: true }, FEATURE.SKU_RATINGS),
    ).toBe(true);
  });
});
