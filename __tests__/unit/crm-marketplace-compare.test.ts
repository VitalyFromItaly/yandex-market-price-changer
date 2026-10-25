import type { TFinanceMarketplace } from '../../src/database/postgres/finance.schema';
import type { ICrmPnlView } from '../../src/modules/crm/finance/crm-finance.domain';
import type { ICrmMarketplaceCompareView } from '../../src/modules/crm/marketplace-compare/crm-marketplace-compare.domain';
import type { TFinancePeriodStatus } from '../../src/modules/finance/finance-period-status';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import {
  AI_TOOL,
  MARKETPLACE_CLOSED_TEXT,
  NO_JOURNAL_TEXT,
} from '../../src/modules/ai-tools/ai-tools.domain';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import {
  CRM_SECTIONS,
  MARKETPLACES_DASHBOARD_SECTION,
} from '../../src/modules/crm/crm-features.domain';
import { CrmFinanceKinds } from '../../src/modules/crm/finance/crm-finance.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import {
  COMPARE_NO_JOURNAL_TEXT,
  MARKETPLACE_COMPARE_KIND,
} from '../../src/modules/crm/marketplace-compare/crm-marketplace-compare.domain';
import { CrmMarketplaceCompareKinds } from '../../src/modules/crm/marketplace-compare/crm-marketplace-compare.kinds';
import {
  DASHBOARD_NEEDS_SECOND_TEXT,
  type ICrmMarketplacesDashboardView,
  MARKETPLACES_DASHBOARD_KIND,
} from '../../src/modules/crm/marketplaces-dashboard/crm-marketplaces-dashboard.domain';
import { CrmMarketplacesDashboardKinds } from '../../src/modules/crm/marketplaces-dashboard/crm-marketplaces-dashboard.kinds';
import { CrmSalesAnalyticsKinds } from '../../src/modules/crm/sales-analytics/crm-sales-analytics.kinds';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import {
  financePeriodKey,
  FINANCE_REPORT_TYPE,
  monthPeriod,
} from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { COMPARE_OPEX_NOTE, COMPARE_TAX_NOTE } from '../../src/modules/finance/marketplace-compare';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  FEATURE,
  FEATURE_META,
  type TFeatureKey,
  isFeatureEnabled,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Сравнение площадок» CRM (TASK-137): каждая колонка — P&L той же площадки, что
 * «Финансы» с `marketplace`, отличия только в двух решениях владельца — доля
 * операционных расходов и налог по начислению.
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
  count: 1,
  transactionSum: 5000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '20.09.2026',
  bankSum: 5000,
  model: 'FBS',
  ...over,
});

/** Строка без выплаты — так выглядят журналы Ozon и WB (paidAt пуст). */
const unpaid = (over: Record<string, unknown> = {}) =>
  row({ paymentStatus: null, bankOrderId: null, bankOrderDate: null, bankSum: null, ...over });

const service = (orderId: number | null, name: string, sum: number, over = {}) =>
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
    ...over,
  });

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let expenses: FinanceExpenseRepository;
let finance: FinanceService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  periods = new FinancePeriodRepository(pg.db);
  expenses = new FinanceExpenseRepository(pg.db);
  finance = new FinanceService(
    operations,
    periods,
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    new FinanceExpensesService(expenses),
    { findByTelegramUser: async () => null } as never,
    // Закуп есть у A1 (общий артикул всех площадок) и B2.
    {
      findBySkus: async () =>
        new Map([
          ['A1', { price: 1500 }],
          ['B2', { price: 1000 }],
        ]),
    } as never,
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

/** Журнал площадки: строки ЯМ-формы, переложенные на площадку, плюс статус месяца. */
async function seed(
  marketplace: TFinanceMarketplace,
  rows: Record<string, unknown>[],
  status: TFinancePeriodStatus,
  period = SEPT,
) {
  const reportType = FINANCE_REPORT_TYPE[marketplace];
  const periodKey = financePeriodKey(reportType, period);
  const { document } = await documents.registerVersion({
    marketplace,
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType,
    periodFrom: period.from,
    periodTo: period.to,
    buffer: Buffer.from(JSON.stringify({ marketplace, rows })),
    filename: 'journal.json',
    contentType: 'application/json',
  });
  const keys = journalKeys(rows);
  await operations.upsertMany(
    rows.map((r, i) => {
      const op = nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey,
      });
      if (marketplace !== 'ozon' || !op.sku) return { ...op, marketplace };
      // Штуки и движение товара у Ozon — по его правилу: тип операции и `items[]`.
      const type =
        op.article === 'returns'
          ? 'ClientReturnAgentOperation'
          : 'OperationAgentDeliveredToCustomer';
      return {
        ...op,
        marketplace,
        transactionType: type,
        raw: { ...op.raw, items: [{ sku: op.sku }] },
      };
    }),
  );
  await periods.upsert({
    marketplace,
    telegramUserId: SELLER,
    reportType,
    periodKey,
    periodFrom: period.from,
    periodTo: period.to,
    status,
    lastOutcome: 'imported',
    documentVersion: document.version,
    unknownCount: 0,
    changedCount: 0,
    removedCount: 0,
    discrepancyCount: 0,
    reconcileState: null,
    reconcileNote: null,
    error: null,
    checkedAt: OCT_15,
  });
}

async function seedAll() {
  // ЯМ: 10 000 ₽ выручки, выплачено.
  await seed(
    'ym',
    [
      row({ transactionSum: 6000 }),
      row({ orderId: 2, shopSku: 'B2', transactionSum: 4000, transactionDate: '18.09.2026 10:00' }),
      service(1, 'Размещение товарных предложений', -1500),
      service(2, 'Доставка покупателю', -500),
    ],
    'verified',
  );
  // Ozon: 30 000 ₽ выручки, выплат нет, возврат.
  await seed(
    'ozon',
    [
      unpaid({ orderId: 11, transactionSum: 20000, model: 'FBO' }),
      unpaid({
        orderId: 12,
        shopSku: 'B2',
        transactionSum: 10000,
        transactionDate: '19.09.2026 11:00',
        model: 'FBO',
      }),
      unpaid({
        orderId: 12,
        shopSku: 'B2',
        transactionSource: 'Возврат платежа покупателя',
        transactionType: 'Возврат',
        transactionSum: -5000,
        transactionDate: '25.09.2026 09:00',
        model: 'FBO',
      }),
      service(11, 'Размещение товарных предложений', -6000),
    ],
    'preliminary',
  );
  // Прошлый месяц: ЯМ 5 000, Ozon 25 000 — рост у ЯМ выше.
  await seed(
    'ym',
    [row({ orderId: 7, transactionSum: 5000, transactionDate: '10.08.2026 10:00' })],
    'verified',
    AUG,
  );
  await seed(
    'ozon',
    [
      unpaid({
        orderId: 17,
        transactionSum: 25000,
        transactionDate: '10.08.2026 10:00',
        model: 'FBO',
      }),
    ],
    'preliminary',
    AUG,
  );
  // 30 000 ₽ в месяц — делятся по доле выручки.
  await expenses.create(SELLER, {
    category: 'rent',
    kind: 'monthly',
    amountKopecks: 3_000_000,
    fromDay: '2026-09-01',
    toDay: null,
    note: null,
  } as never);
}

const ALL_OPEN = { [FEATURE.OZON]: true, [FEATURE.WB]: true };
const contextOf = (params: Record<string, unknown>, features: Record<string, boolean> = ALL_OPEN) =>
  ({ telegramUserId: SELLER, store: {} as never, params, features }) as const;

const SEPT_PARAMS = { from: SEPT.from, to: SEPT.to, prevFrom: AUG.from, prevTo: AUG.to };

const kinds = () => new CrmMarketplaceCompareKinds({ register: vi.fn() } as never, finance);
const financeKinds = () => new CrmFinanceKinds({ register: vi.fn() } as never, finance);

async function pnlOf(marketplace: TFinanceMarketplace): Promise<ICrmPnlView> {
  const { data } = await financeKinds().run(contextOf({ month: '2026-09', marketplace }), OCT_15);
  return data as ICrmPnlView;
}

describe('«Сравнение площадок» = «Финансы» площадок', () => {
  it('выручка, себестоимость и услуги колонки = finance:pnl той же площадки до копейки', async () => {
    await seedAll();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const view = data as ICrmMarketplaceCompareView;

    for (const marketplace of ['ym', 'ozon'] as const) {
      const pnl = await pnlOf(marketplace);
      expect(pnl.marketplace).toBe(marketplace);
      const column = view.columns.find((c) => c.marketplace === marketplace);
      expect(column?.state).toBe('ok');
      expect(column?.metrics?.revenueKopecks).toBe(pnl.levels.revenueKopecks);
      expect(column?.metrics?.cogsKopecks).toBe(pnl.levels.cogsKopecks);
      expect(column?.metrics?.marketplaceKopecks).toBe(pnl.levels.marketplaceKopecks);
    }
    const ym = view.columns[0].metrics;
    const ozon = view.columns[1].metrics;
    expect(ym?.revenueKopecks).toBe(1_000_000);
    expect(ozon?.revenueKopecks).toBe(2_500_000);
    expect(ozon?.returnsShare).toBeCloseTo(5000 / 30000);
  });

  it('операционные расходы делятся по доле выручки: Σ = расходам кабинета', async () => {
    await seedAll();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const view = data as ICrmMarketplaceCompareView;
    const shares = view.columns.map((c) => c.metrics?.operatingExpensesKopecks ?? 0);
    expect(view.operatingExpensesKopecks).toBe(3_000_000);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(3_000_000);
    // 10 000 : 25 000 = 2 : 5.
    expect(shares[0]).toBe(Math.round((3_000_000 * 2) / 7));
    // «Финансы» площадки несут расходы целиком.
    expect((await pnlOf('ozon')).levels.operatingExpensesKopecks).toBe(3_000_000);
  });

  it('налог по начислению у всех: у Ozon без выплат он есть, хотя «Финансы» по поступлению дают 0', async () => {
    await seedAll();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const view = data as ICrmMarketplaceCompareView;
    expect((await pnlOf('ozon')).levels.taxKopecks).toBe(0);
    expect(view.columns[1].metrics?.taxKopecks).toBeGreaterThan(0);
    expect(view.notes).toContain(COMPARE_TAX_NOTE);
  });

  it('статус: проверенная площадка и предварительная; WB без журнала — без чисел', async () => {
    await seedAll();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const view = data as ICrmMarketplaceCompareView;
    expect(view.columns.map((c) => [c.marketplace, c.state, c.verified])).toEqual([
      ['ym', 'ok', true],
      ['ozon', 'ok', false],
      ['wb', 'no-journal', false],
    ]);
    expect(view.columns[2]).toMatchObject({ metrics: null, reason: COMPARE_NO_JOURNAL_TEXT });
    expect(view.notes.some((note) => note.startsWith('Сравнение предварительное'))).toBe(true);
  });

  it('выводы: больше денег — Ozon, лучший рост — ЯМ, выгоднее товар — по общему артикулу', async () => {
    await seedAll();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const view = data as ICrmMarketplaceCompareView;
    const byKind = Object.fromEntries(view.conclusions.map((c) => [c.kind, c]));
    expect(byKind.revenue.winner).toBe('ozon');
    expect(byKind.growth.winner).toBe('ym');
    expect(byKind.returns.winner).toBe('ozon');
    // B2 на Ozon вернулся целиком (0 шт.) — сравним только A1, и на Ozon он выгоднее.
    expect(byKind.product.productWins).toEqual({ ozon: 1 });
    expect(byKind.product.products?.map((p) => [p.sku, p.winner, p.runnerUp])).toEqual([
      ['A1', 'ozon', 'ym'],
    ]);
    expect(byKind.scheme.winner).toBe('ozon');
  });

  it('закрытая фича площадки — колонка closed, журнал не читается', async () => {
    await seedAll();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS, { [FEATURE.WB]: true }));
    const view = data as ICrmMarketplaceCompareView;
    expect(view.columns[1]).toMatchObject({ marketplace: 'ozon', state: 'closed', metrics: null });
    expect(view.conclusions.find((c) => c.kind === 'revenue')?.winner).toBeNull();
  });

  it('finance:pnl: площадка из параметра, мусор и закрытая площадка — понятный отказ', async () => {
    await seedAll();
    expect((await pnlOf('ym')).levels.revenueKopecks).toBe(1_000_000);
    await expect(
      financeKinds().run(contextOf({ month: '2026-09', marketplace: 'avito' }), OCT_15),
    ).rejects.toBeInstanceOf(CrmJobError);
    await expect(
      financeKinds().run(contextOf({ month: '2026-09', marketplace: 'ozon' }, {}), OCT_15),
    ).rejects.toBeInstanceOf(CrmJobError);
    const { data } = await financeKinds().run(contextOf({ month: '2026-09' }, {}), OCT_15);
    expect((data as ICrmPnlView).marketplace).toBe('ym');
  });

  it('кривой период — понятный отказ', async () => {
    await expect(
      kinds().summary(contextOf({ from: '2026-09-30', to: '2026-09-01' })),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('kind под marketplace_compare, раздел аккаунта; фича выключена и требует finance', () => {
    const register = vi.fn();
    new CrmMarketplaceCompareKinds({ register } as never, finance).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      MARKETPLACE_COMPARE_KIND,
      expect.objectContaining({ features: [FEATURE.MARKETPLACE_COMPARE], scope: 'account' }),
    );
    expect(CRM_SECTIONS['ym-marketplace-compare']).toEqual([FEATURE.MARKETPLACE_COMPARE]);
    expect(FEATURE_META[FEATURE.MARKETPLACE_COMPARE].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.MARKETPLACE_COMPARE].requires).toEqual([FEATURE.FINANCE]);
    expect(
      isFeatureEnabled({ [FEATURE.MARKETPLACE_COMPARE]: true }, FEATURE.MARKETPLACE_COMPARE),
    ).toBe(false);
  });
});

/** Строка площадки в ответе `compareMarketplaces`. */
interface IAiCompareRow {
  marketplace: TFinanceMarketplace;
  insufficientData?: boolean;
  reason?: string;
  levels?: Record<string, { kopecks: number }>;
}

describe('compareMarketplaces ИИ = «Сравнение площадок» (TASK-173)', () => {
  const askAi = async (features: Set<TFeatureKey>) => {
    const tools = new AiToolsService(
      finance,
      {} as never,
      {} as never,
      { report: vi.fn() } as never,
    );
    const box = tools.toolbox(SELLER, () => OCT_15, { features });
    return box.call(AI_TOOL.COMPARE, JSON.stringify({ from: SEPT.from, to: SEPT.to }));
  };
  const ALL = new Set<TFeatureKey>([FEATURE.OZON, FEATURE.WB]);

  it('три площадки: уровни каждой = колонке экрана до копейки, правила — строками', async () => {
    await seedAll();
    await seed('wb', [unpaid({ orderId: 21, transactionSum: 8000 })], 'preliminary');
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const view = data as ICrmMarketplaceCompareView;
    const result = await askAi(ALL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const answer = result.data as { rules: string[]; marketplaces: IAiCompareRow[] };
    expect(answer.marketplaces.map((m) => m.marketplace)).toEqual(['ym', 'ozon', 'wb']);
    for (const column of view.columns) {
      expect(column.state).toBe('ok');
      const levels = answer.marketplaces.find((m) => m.marketplace === column.marketplace)?.levels;
      expect(levels?.revenue.kopecks).toBe(column.metrics?.revenueKopecks);
      expect(levels?.cogs.kopecks).toBe(column.metrics?.cogsKopecks);
      expect(levels?.marketplaceExpenses.kopecks).toBe(column.metrics?.marketplaceKopecks);
      expect(levels?.operatingExpenses.kopecks).toBe(column.metrics?.operatingExpensesKopecks);
      expect(levels?.tax.kopecks).toBe(column.metrics?.taxKopecks);
      expect(levels?.net.kopecks).toBe(column.metrics?.netKopecks);
    }
    expect(answer.rules).toEqual(expect.arrayContaining([COMPARE_TAX_NOTE, COMPARE_OPEX_NOTE]));
    expect(result.sourceRefs?.source).toBe('finance:compare');
    expect(result.sourceRefs?.operationCount).toBeGreaterThan(0);
  });

  it('закрытая ozon — причина «закрыта», WB без журнала — NO_JOURNAL_TEXT; не нули', async () => {
    await seedAll();
    const result = await askAi(new Set([FEATURE.WB]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = (result.data as { marketplaces: IAiCompareRow[] }).marketplaces;
    expect(rows[0].levels?.revenue.kopecks).toBe(1_000_000);
    expect(rows[1]).toEqual({
      marketplace: 'ozon',
      label: expect.any(String),
      insufficientData: true,
      reason: MARKETPLACE_CLOSED_TEXT('ozon'),
    });
    expect(rows[2]).toMatchObject({ insufficientData: true, reason: NO_JOURNAL_TEXT });
    expect(rows[1]).not.toHaveProperty('levels');
    expect(rows[2]).not.toHaveProperty('levels');
  });

  it('журнала нет ни у одной площадки — insufficientData целиком', async () => {
    expect(await askAi(ALL)).toMatchObject({ ok: false, insufficientData: true });
  });
});

describe('Дашборд «Площадки» = «Сравнение площадок» + «Аналитика продаж» (TASK-191)', () => {
  /** ЯМ подключён ключом, Ozon/WB — строками подключений с итогом проверки. */
  const YM_STORE = { token: 't', campaign_id: 'c1', business_id: 'b1', stores: [] };
  const rowOf = (marketplace: 'ozon' | 'wb', status = 'ok') => ({
    marketplace,
    telegramUserId: SELLER,
    status,
    accounts: [],
  });
  const dashboard = (rows: unknown[] = [rowOf('ozon'), rowOf('wb')], ym: unknown = YM_STORE) =>
    new CrmMarketplacesDashboardKinds(
      { register: vi.fn() } as never,
      finance,
      { findByTelegramUser: async () => ym } as never,
      { findForUser: async () => rows } as never,
    );
  const salesKinds = () =>
    new CrmSalesAnalyticsKinds({ register: vi.fn() } as never, finance, {
      findByJournalSkus: async () => new Map(),
    } as never);
  const viewOf = async (rows?: unknown[], features: Record<string, boolean> = ALL_OPEN) => {
    const { data } = await dashboard(rows).summary(contextOf(SEPT_PARAMS, features));
    return data as ICrmMarketplacesDashboardView;
  };

  it('KPI колонки = колонке «Сравнения площадок» того же периода до копейки', async () => {
    await seedAll();
    const view = await viewOf();
    const { data } = await kinds().summary(contextOf(SEPT_PARAMS));
    const compare = data as ICrmMarketplaceCompareView;
    for (const column of view.columns) {
      const twin = compare.columns.find((c) => c.marketplace === column.marketplace);
      const { days: _days, ...rest } = column;
      expect(rest).toEqual(twin);
    }
    expect(view.conclusions).toEqual(compare.conclusions);
  });

  it('ряд по дням = «Аналитике продаж» площадки, Σ дней = выручке колонки', async () => {
    await seedAll();
    const view = await viewOf();
    for (const marketplace of ['ym', 'ozon'] as const) {
      const column = view.columns.find((c) => c.marketplace === marketplace);
      const { data } = await salesKinds().summary(
        contextOf({ ...SEPT_PARAMS, marketplace }),
        OCT_15,
      );
      expect(column?.days).toEqual((data as { days: unknown[] }).days);
      const sum = (column?.days ?? []).reduce((acc, day) => acc + day.revenueKopecks, 0);
      expect(sum).toBe(column?.metrics?.revenueKopecks);
    }
  });

  it('площадка без журнала — «нет данных» с причиной, без нулей и без дней', async () => {
    await seedAll();
    const view = await viewOf();
    expect(view.columns.map((c) => c.marketplace)).toEqual(['ym', 'ozon', 'wb']);
    expect(view.columns[2]).toMatchObject({
      state: 'no-journal',
      reason: COMPARE_NO_JOURNAL_TEXT,
      metrics: null,
      days: [],
    });
  });

  it('только подключённые и открытые: WB rejected и закрытый Ozon — не колонки', async () => {
    await seedAll();
    const view = await viewOf([rowOf('ozon'), rowOf('wb', 'rejected')]);
    expect(view.columns.map((c) => c.marketplace)).toEqual(['ym', 'ozon']);
    await expect(
      dashboard([rowOf('ozon'), rowOf('wb', 'rejected')]).summary(
        contextOf(SEPT_PARAMS, { [FEATURE.WB]: true }),
      ),
    ).rejects.toThrow(DASHBOARD_NEEDS_SECOND_TEXT);
  });

  it('одна площадка — понятный отказ; без ЯМ, но с Ozon и WB — дашборд есть', async () => {
    await expect(dashboard([]).summary(contextOf(SEPT_PARAMS))).rejects.toThrow(
      DASHBOARD_NEEDS_SECOND_TEXT,
    );
    // Без ЯМ, но с Ozon и WB — две площадки, дашборд есть.
    const { data } = await dashboard(undefined, null).summary(contextOf(SEPT_PARAMS));
    expect((data as ICrmMarketplacesDashboardView).columns.map((c) => c.marketplace)).toEqual([
      'ozon',
      'wb',
    ]);
  });

  it('kind под marketplaces_dashboard, раздел аккаунта; фича выключена и требует finance', () => {
    const register = vi.fn();
    new CrmMarketplacesDashboardKinds(
      { register } as never,
      finance,
      {} as never,
      {} as never,
    ).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      MARKETPLACES_DASHBOARD_KIND,
      expect.objectContaining({ features: [FEATURE.MARKETPLACES_DASHBOARD], scope: 'account' }),
    );
    expect(CRM_SECTIONS[MARKETPLACES_DASHBOARD_SECTION]).toEqual([FEATURE.MARKETPLACES_DASHBOARD]);
    expect(FEATURE_META[FEATURE.MARKETPLACES_DASHBOARD].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.MARKETPLACES_DASHBOARD].requires).toEqual([FEATURE.FINANCE]);
    expect(
      isFeatureEnabled({ [FEATURE.MARKETPLACES_DASHBOARD]: true }, FEATURE.MARKETPLACES_DASHBOARD),
    ).toBe(false);
  });
});
