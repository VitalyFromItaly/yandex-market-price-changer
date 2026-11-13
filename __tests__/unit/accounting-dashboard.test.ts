import type { ITestFinanceDb } from '../helpers/test-postgres';
import type {
  IDashboardItem,
  TDashboardLine,
} from '../../src/modules/accounting/accounting-dashboard.domain';
import type { IAccountingDashboard } from '../../src/modules/accounting/accounting-dashboard.service';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { TOrderUnitCost } from '../../src/modules/accounting/order-result';
import type { ICrmJobContext } from '../../src/modules/crm/jobs/crm-jobs.domain';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingAllocationSettingsRepository } from '../../src/database/postgres/repositories/accounting-allocation-settings.repository';
import { AccountingManualOperationRepository } from '../../src/database/postgres/repositories/accounting-manual-operation.repository';
import { AccountingOrderLineRepository } from '../../src/database/postgres/repositories/accounting-order-line.repository';
import { AccountingOrderResultRepository } from '../../src/database/postgres/repositories/accounting-order-result.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { AccountingAllocationSettingsService } from '../../src/modules/accounting/accounting-allocation-settings.service';
import {
  DASHBOARD_LINES,
  DASHBOARD_LINE_OF_RESULT_KEY,
  dashboardLineOfArticle,
  dashboardTotalsOf,
  filterDashboardItems,
} from '../../src/modules/accounting/accounting-dashboard.domain';
import { AccountingDashboardService } from '../../src/modules/accounting/accounting-dashboard.service';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import { AccountingOrderCardService } from '../../src/modules/accounting/accounting-order-card.service';
import { AccountingStoreCostsService } from '../../src/modules/accounting/accounting-store-costs.service';
import {
  ACCOUNTING_DASHBOARD_BAD_BASIS_TEXT,
  ACCOUNTING_DASHBOARD_DRILL_KIND,
  ACCOUNTING_DASHBOARD_KIND,
  parseAccountingDashboardLine,
  parseAccountingDashboardQuery,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import {
  ACCOUNTING_DASHBOARD_FEATURES,
  CrmAccountingKinds,
} from '../../src/modules/crm/accounting/crm-accounting.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { FINANCE_ARTICLE_KEYS } from '../../src/modules/finance/finance-articles';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { purchasesServiceOf } from '../helpers/purchases-service';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Панель «Финучёта» (TASK-229) на PGlite. Один заказ живёт в трёх месяцах
 * по-разному: оформлен 30.09, продажа и комиссия начислены 02.10, выплата 08.10;
 * доставка — ручная операция 03.10; расход бизнеса 05.10. Налог, закуп и
 * прогноз — заглушки (свои тесты у них есть).
 */

const SELLER = '322';
const SEPT = monthPeriod(2026, 9);
const OCT = monthPeriod(2026, 10);
const NOW = new Date('2026-10-20T09:00:00Z');
const STORE = { campaign_id: 'c1' } as never;
const ACTOR = { author: SELLER, impersonatedBy: null };

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '02.10.2026 14:05',
  actId: null,
  count: 1,
  transactionSum: 10000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '08.10.2026',
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
  actDate: '31.10.2026',
});

function line(partial: Partial<IAccountingOrderLineInput> = {}): IAccountingOrderLineInput {
  return {
    marketplace: 'ym',
    orderId: '1',
    itemId: '1',
    campaignId: 'c1',
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
    createdOn: '2026-09-30',
    soldOn: '2026-10-02',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  };
}

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let orderLines: AccountingOrderLineRepository;
let manual: AccountingManualOperationsService;
let expenses: FinanceExpensesService;
let cards: AccountingOrderCardService;
let service: AccountingDashboardService;

const marketplacesOf = vi.fn(async () => ['ym']);
const syncStatus = vi.fn(async () => ({
  asOf: '2026-10-20T03:00:00.000Z',
  everyHours: 6,
  reloadMonths: 2,
  marketplaces: [
    {
      marketplace: 'ym',
      label: 'Яндекс Маркет',
      lastSuccessAt: '2026-10-20T03:00:00.000Z',
      periods: [],
    },
  ],
}));
const orderTaxItem = vi.fn(async () => null);
const taxPeriod = vi.fn(async () => ({ tax: { taxKopecks: 60_000 }, ruleTitle: 'УСН 6%' }));
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
const build = vi.fn(async () => ({ account: null, skus: [] }));

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  orderLines = new AccountingOrderLineRepository(pg.db);
  manual = new AccountingManualOperationsService(new AccountingManualOperationRepository(pg.db));
  expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  const accounting = { marketplacesOf, syncStatus } as never;
  cards = new AccountingOrderCardService(
    accounting,
    orderLines,
    operations,
    manual,
    new AccountingStoreCostsService(
      new AccountingAllocationSettingsService(new AccountingAllocationSettingsRepository(pg.db)),
      expenses,
    ),
    { orderTaxItem } as never,
    { unitCostResolver, lotCostOf: async () => null } as never,
    { reconcile } as never,
    { build } as never,
    new AccountingOrderResultRepository(pg.db),
  );
  service = new AccountingDashboardService(
    accounting,
    cards,
    operations,
    orderLines,
    manual,
    { period: taxPeriod } as never,
    expenses,
    new FinanceCashflowService(operations, expenses, purchasesServiceOf(pg.db)),
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
  const documents = new FinanceDocumentRepository(pg.db);
  const rows = [row(), commission];
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: OCT.from,
    periodTo: OCT.to,
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
        periodKey: financePeriodKey('united-netting', OCT),
      }),
    ),
  );
  await orderLines.upsertLines(SELLER, [line()]);
  await manual.create(
    SELLER,
    {
      clientKey: randomUUID(),
      marketplace: 'ym',
      article: 'delivery_to_buyer',
      amount: '-100',
      accruedOn: '2026-10-03',
      orderId: '1',
      source: 'Акт',
    },
    ACTOR,
  );
  await expenses.create(SELLER, {
    category: 'packaging',
    kind: 'one_off',
    amount: 500,
    fromDay: '2026-10-05',
  });
}, 60_000);

const lineOf = (dashboard: IAccountingDashboard, key: TDashboardLine, block = 0) =>
  dashboard.totals.byMarketplace[block].lines.find((l) => l.line === key);
const ym = (dashboard: IAccountingDashboard) => dashboard.totals.byMarketplace[0];

describe('AccountingDashboardService — один период в трёх базисах', () => {
  it('продажа: заказ сентября целиком в сентябре — как его карточка', async () => {
    const sept = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'sale', period: SEPT, filter: {} },
      NOW,
    );
    expect(sept.basisTitle).toBe('По дате продажи');
    expect(lineOf(sept, 'revenue').kopecks).toBe(1_000_000);
    expect(lineOf(sept, 'commission').kopecks).toBe(-230_000);
    expect(lineOf(sept, 'logistics').kopecks).toBe(-10_000);
    expect(lineOf(sept, 'cogs').kopecks).toBe(-300_000);
    expect(ym(sept).grossKopecks).toBe(700_000);
    expect(ym(sept).netKopecks).toBe(460_000);
    expect(ym(sept).marginPercent).toBe(46);
    // Одна площадка и нет строк кабинета — «Все площадки» не выводится.
    expect(sept.totals.all).toBeNull();
    expect(sept.sync.asOf).toBe('2026-10-20T03:00:00.000Z');

    const card = await cards.order(SELLER, {}, STORE, { marketplace: 'ym', orderId: '1' }, NOW);
    expect(card.netKopecks).toBe(ym(sept).netKopecks);

    const oct = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'sale', period: OCT, filter: {} },
      NOW,
    );
    expect(lineOf(oct, 'revenue').count).toBe(0);
    expect(ym(oct).netKopecks).toBe(0);
  });

  it('начисление: сентябрь пуст, в октябре — операции, себестоимость проданного, налог и расход', async () => {
    const sept = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'accrual', period: SEPT, filter: {} },
      NOW,
    );
    expect(lineOf(sept, 'revenue').kopecks).toBe(0);
    expect(lineOf(sept, 'cogs').kopecks).toBe(0);

    const oct = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'accrual', period: OCT, filter: {} },
      NOW,
    );
    expect(lineOf(oct, 'revenue').kopecks).toBe(1_000_000);
    expect(lineOf(oct, 'commission').kopecks).toBe(-230_000);
    expect(lineOf(oct, 'logistics').kopecks).toBe(-10_000);
    expect(lineOf(oct, 'cogs').kopecks).toBe(-300_000);
    // Налог и расход бизнеса — уровня кабинета: в блоке площадки их нет, в «Все площадки» есть.
    expect(lineOf(oct, 'tax').kopecks).toBe(0);
    expect(ym(oct).excludesAccountLevel).toBe(true);
    expect(ym(oct).netKopecks).toBe(460_000);
    expect(oct.totals.all.label).toBe('Все площадки');
    expect(oct.totals.all.lines.find((l) => l.line === 'tax').kopecks).toBe(-60_000);
    expect(oct.totals.all.lines.find((l) => l.line === 'opex').kopecks).toBe(-50_000);
    expect(oct.totals.all.netKopecks).toBe(350_000);
  });

  it('деньги: в октябре — выплаченные строки; ручной доставки и себестоимости нет, расход — по дню оплаты', async () => {
    const oct = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'cash', period: OCT, filter: {} },
      NOW,
    );
    expect(oct.basisTitle).toBe('По движению денег');
    expect(lineOf(oct, 'revenue').kopecks).toBe(1_000_000);
    expect(lineOf(oct, 'commission').kopecks).toBe(-230_000);
    expect(lineOf(oct, 'logistics').kopecks).toBe(0);
    expect(lineOf(oct, 'cogs').title).toBe('Оплаты закупа');
    expect(lineOf(oct, 'cogs').kopecks).toBe(0);
    expect(ym(oct).receivedKopecks).toBe(770_000);
    expect(oct.totals.all.lines.find((l) => l.line === 'opex').kopecks).toBe(-50_000);
    expect(oct.totals.all.netKopecks).toBe(720_000);

    const sept = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'cash', period: SEPT, filter: {} },
      NOW,
    );
    expect(lineOf(sept, 'revenue').kopecks).toBe(0);
    expect(ym(sept).receivedKopecks).toBe(0);
  });

  it('раскрытие: Σ строки = числу панели, операции — те же, что в карточке', async () => {
    const query = { basis: 'sale' as const, period: SEPT, filter: {} };
    const drill = await service.drill(
      SELLER,
      {},
      STORE,
      query,
      { line: 'commission', marketplace: 'ym' },
      NOW,
    );
    expect(drill.kopecks).toBe(-230_000);
    expect(drill.operations.map((op) => op.kopecks)).toEqual([-230_000]);
    expect(drill.operations[0].documentId).not.toBeNull();

    const cogs = await service.drill(
      SELLER,
      {},
      STORE,
      query,
      { line: 'cogs', marketplace: 'ym' },
      NOW,
    );
    expect(cogs.orders).toEqual([
      expect.objectContaining({ marketplace: 'ym', orderId: '1', kopecks: -300_000 }),
    ]);

    const tax = await service.drill(
      SELLER,
      {},
      STORE,
      { basis: 'accrual', period: OCT, filter: {} },
      { line: 'tax', marketplace: null },
      NOW,
    );
    expect(tax.label).toBe('Все площадки');
    expect(tax.records).toEqual([expect.objectContaining({ source: 'tax', kopecks: -60_000 })]);
  });

  it('фильтр по заказу: общие строки выпадают с подписью, «к выплате» не делится', async () => {
    const oct = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'accrual', period: OCT, filter: { orderId: '1' } },
      NOW,
    );
    expect(oct.totals.all).toBeNull();
    expect(lineOf(oct, 'revenue').kopecks).toBe(1_000_000);
    expect(ym(oct).payableKopecks).toBeNull();
    expect(oct.filterNote).toContain('выбранного заказа');

    const other = await service.summary(
      SELLER,
      {},
      STORE,
      { basis: 'accrual', period: OCT, filter: { offerId: 'ZZ' } },
      NOW,
    );
    expect(lineOf(other, 'revenue').kopecks).toBe(0);
  });
});

describe('домен панели', () => {
  const item = (over: Partial<IDashboardItem>): IDashboardItem => ({
    marketplace: 'ym',
    line: 'revenue',
    kopecks: 0,
    expected: false,
    source: 'journal',
    operationIds: [],
    refId: null,
    orderKey: null,
    sku: null,
    title: '',
    reason: null,
    ...over,
  });
  const money = () => ({ payableKopecks: 0, receivedKopecks: 0 });

  it('каждая статья и строка карточки — на своей строке панели, возвраты — отдельно', () => {
    for (const article of FINANCE_ARTICLE_KEYS) {
      const line = dashboardLineOfArticle(article);
      expect(line === 'reference' || DASHBOARD_LINES.includes(line)).toBe(true);
    }
    expect(dashboardLineOfArticle('returns')).toBe('returns');
    expect(dashboardLineOfArticle('sales')).toBe('revenue');
    expect(
      Object.values(DASHBOARD_LINE_OF_RESULT_KEY).every((l) => DASHBOARD_LINES.includes(l)),
    ).toBe(true);
  });

  it('неизвестная себестоимость — валовая, чистая и рентабельность null, а не «прибыль без закупа»', () => {
    const totals = dashboardTotalsOf(
      'sale',
      [item({ kopecks: 100_000 }), item({ line: 'cogs', kopecks: null, reason: 'no-record' })],
      ['ym'],
      money,
    );
    const block = totals.byMarketplace[0];
    expect(block.lines.find((l) => l.line === 'cogs')).toMatchObject({
      kopecks: null,
      unknownReason: 'no-record',
    });
    expect(block.grossKopecks).toBeNull();
    expect(block.netKopecks).toBeNull();
    expect(block.marginPercent).toBeNull();
  });

  it('две площадки — отдельные блоки и «Все площадки» с подписью', () => {
    const totals = dashboardTotalsOf(
      'accrual',
      [item({ kopecks: 100 }), item({ marketplace: 'ozon', kopecks: 50 })],
      ['ym', 'ozon'],
      money,
    );
    expect(totals.byMarketplace.map((b) => [b.label, b.netKopecks])).toEqual([
      ['Яндекс Маркет', 100],
      ['Ozon', 50],
    ]);
    expect(totals.all).toMatchObject({ label: 'Все площадки', netKopecks: 150 });
  });

  it('фильтр площадки выкидывает строки кабинета', () => {
    const catalog = { skusOf: new Map(), nameOf: new Map() };
    const result = filterDashboardItems(
      [item({ kopecks: 100 }), item({ marketplace: null, line: 'tax', kopecks: -10 })],
      { marketplace: 'ym' },
      catalog,
    );
    expect(result.items).toHaveLength(1);
    expect(result.droppedCount).toBe(1);
  });
});

describe('CrmAccountingKinds — панель', () => {
  const registry = { register: vi.fn() };
  const context = (params: Record<string, unknown>): ICrmJobContext => ({
    jobId: 'j1',
    telegramUserId: SELLER,
    store: STORE,
    params,
    features: {},
  });

  it('kind-ы под зонтиком и подфичей панели, магазина из URL', () => {
    new CrmAccountingKinds(
      registry as never,
      {} as never,
      {} as never,
      service,
      {} as never,
      {} as never,
    ).onModuleInit();
    const registered = Object.fromEntries(
      registry.register.mock.calls.map(([kind, def]) => [kind, def]),
    );
    expect(ACCOUNTING_DASHBOARD_FEATURES).toEqual([
      FEATURE.FIN_ACCOUNTING,
      FEATURE.FIN_ACCOUNTING_DASHBOARD,
    ]);
    for (const kind of [ACCOUNTING_DASHBOARD_KIND, ACCOUNTING_DASHBOARD_DRILL_KIND]) {
      expect(registered[kind].features).toEqual(ACCOUNTING_DASHBOARD_FEATURES);
      expect(registered[kind].scope).toBeUndefined();
    }
  });

  it('без базиса — понятный отказ; базис подписан в ответе', async () => {
    const kinds = new CrmAccountingKinds(
      registry as never,
      {} as never,
      {} as never,
      service,
      {} as never,
      {} as never,
    );
    await expect(kinds.dashboardSummary(context({}), NOW)).rejects.toThrow(
      new CrmJobError(ACCOUNTING_DASHBOARD_BAD_BASIS_TEXT),
    );
    const output = await kinds.dashboardSummary(
      context({ basis: 'accrual', range: { from: OCT.from, to: OCT.to } }),
      NOW,
    );
    expect(output.data).toMatchObject({
      basis: 'accrual',
      basisTitle: 'По дате начисления',
      periodEcho: { key: null, range: { from: OCT.from, to: OCT.to } },
    });
  });

  it('разбор запроса: пресеты, произвольный период, мусор', () => {
    const month = parseAccountingDashboardQuery({ basis: 'cash', period: { key: 'month' } }, NOW);
    expect(month).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-20' } });
    expect(parseAccountingDashboardQuery({ basis: 'cash', period: { key: 'all' } }, NOW)).toBe(
      'period',
    );
    expect(parseAccountingDashboardQuery({ basis: 'x' }, NOW)).toBe('basis');
    expect(
      parseAccountingDashboardQuery({
        basis: 'sale',
        range: { from: '2026-10-05', to: '2026-10-01' },
      }),
    ).toBe('period');
    expect(parseAccountingDashboardQuery({ basis: 'sale', brand: 'nope' }, NOW)).toBe('filter');
    expect(parseAccountingDashboardLine({ line: 'net' })).toBeNull();
    expect(parseAccountingDashboardLine({ line: 'tax', block: 'all' })).toEqual({
      line: 'tax',
      marketplace: null,
    });
  });
});
