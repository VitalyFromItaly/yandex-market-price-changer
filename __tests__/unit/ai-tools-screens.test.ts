import type { ICrmPriceCalcRates } from '../../src/modules/crm/price-calculator/crm-price-calc.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { TFeatureKey } from '../../src/modules/telegram/bots/shared/features.domain';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceTaxYearRepository } from '../../src/database/postgres/repositories/finance-tax-year.repository';
import { analystSystemPrompt } from '../../src/modules/ai-analyst/ai-analyst.domain';
import {
  AI_GATED_FEATURES,
  AI_TOOL,
  AI_TOOL_FEATURE,
  NO_EXPENSES_TEXT,
  NO_JOURNAL_TEXT,
  NO_PRICE_COGS_TEXT,
  NO_PRICE_RATES_TEXT,
  NO_TAX_JOURNAL_TEXT,
  PRICE_TARGET_INVALID_TEXT,
  TAX_YEAR_ARG_INVALID_TEXT,
} from '../../src/modules/ai-tools/ai-tools.domain';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import { CrmPriceCalcKinds } from '../../src/modules/crm/price-calculator/crm-price-calc.kinds';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { FinanceTaxYearDataService } from '../../src/modules/finance/finance-tax-year-data.service';
import { FinanceTaxYearService } from '../../src/modules/finance/finance-tax-year.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { PriceCalcRatesService } from '../../src/modules/finance/price-calc-rates.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { PRICE_CALC_FAILURE_TEXT, priceFor } from '../../src/shared/price-calc';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Инструменты денег, налогов, цены и расходов (TASK-165) на PGlite: каждый —
 * та же дверь, что экран, поэтому ответ сверяется с вызовом этой двери напрямую.
 * И каждый виден модели только при открытой фиче своего экрана.
 */

const SELLER = '111';
const EMPTY = '333';
const SEPT = monthPeriod(2026, 9);
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
  bankSum: 3850,
  model: 'FBS',
  ...over,
});

const service = (orderId: number, name: string, sum: number) =>
  row({
    orderId,
    shopSku: null,
    count: null,
    offerOrServiceName: name,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    transactionSum: sum,
  });

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let finance: FinanceService;
let expenses: FinanceExpensesService;
let cashflow: FinanceCashflowService;
let taxYear: FinanceTaxYearService;
let rates: PriceCalcRatesService;

const store = { telegramUserId: SELLER, commissionPercent: 23, taxPercent: 7, discountPercent: 0 };
const NAMES = [{ marketplaceSkus: { ym: 'A1' }, name: 'Casio F-91W' }];
/** Прайс: закуп есть только у A1. */
const purchasePrices = {
  findBySkus: async (_uid: string, skus: readonly string[]) =>
    new Map(skus.filter((s) => s === 'A1').map((s) => [s, { price: 1500 }])),
};

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  periods = new FinancePeriodRepository(pg.db);
  const taxes = new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db));
  expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  finance = new FinanceService(
    operations,
    periods,
    taxes,
    expenses,
    { findByTelegramUser: async () => store } as never,
    purchasePrices as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
  cashflow = new FinanceCashflowService(
    operations,
    expenses,
    new FinancePurchasesService(new FinancePurchaseRepository(pg.db)),
  );
  taxYear = new FinanceTaxYearService(
    finance,
    taxes,
    new FinanceTaxYearDataService(new FinanceTaxYearRepository(pg.db)),
    new FinancePurchaseRepository(pg.db),
  );
  rates = new PriceCalcRatesService(
    finance,
    taxes,
    { findByYmSkus: async () => NAMES } as never,
    purchasePrices as never,
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
});

function tools() {
  return new AiToolsService(
    finance,
    {} as never,
    {} as never,
    { report: vi.fn() } as never,
    {} as never,
    cashflow,
    expenses,
    taxYear,
    rates,
    { findByTelegramUser: async () => store } as never,
    {} as never,
    {} as never,
  );
}

const ALL_OPEN = new Set(AI_GATED_FEATURES);

const call = (name: string, args: unknown, uid = SELLER) =>
  tools()
    .toolbox(uid, () => OCT_15, { features: ALL_OPEN })
    .call(name, JSON.stringify(args)) as Promise<{
    ok: boolean;
    data?: Record<string, never>;
    insufficientData?: boolean;
    reason?: string;
    error?: string;
    sourceRefs?: { source: string; operationIds: string[]; operationCount: number };
  }>;

async function seed(rows: Record<string, unknown>[]) {
  const key = financePeriodKey('united-netting', SEPT);
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
        periodKey: key,
      }),
    ),
  );
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId: SELLER,
    reportType: 'united-netting',
    periodKey: key,
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    checkedAt: new Date(),
    status: 'verified',
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

const seedSept = () =>
  seed([
    row(),
    row({ orderId: 2, count: 1, transactionSum: 2500, paymentStatus: null, bankOrderId: null }),
    service(1, 'Размещение товарных предложений', -1150),
  ]);

const rent = { kind: 'monthly', category: 'rent', amount: '30 000', fromDay: '2026-09-01' };

describe('видимость за фичей экрана', () => {
  const GATED = [
    AI_TOOL.CASHFLOW,
    AI_TOOL.TAX_YEAR,
    AI_TOOL.PRICE,
    AI_TOOL.EXPENSES,
    AI_TOOL.STOCKS,
    AI_TOOL.RETURNS,
  ];

  it('фичи экранов: ДДС — finance, налоги — tax_year, цена — price_calculator, расходы — expenses, остатки — inventory, возвраты — report_returning', () => {
    expect(AI_TOOL_FEATURE).toMatchObject({
      [AI_TOOL.CASHFLOW]: FEATURE.FINANCE,
      [AI_TOOL.TAX_YEAR]: FEATURE.TAX_YEAR,
      [AI_TOOL.PRICE]: FEATURE.PRICE_CALCULATOR,
      [AI_TOOL.EXPENSES]: FEATURE.EXPENSES,
      [AI_TOOL.STOCKS]: FEATURE.INVENTORY,
      [AI_TOOL.RETURNS]: FEATURE.REPORT_RETURNING,
    });
  });

  it.each(GATED)(
    '%s: без фичи нет в definitions и call отказывает как неизвестный',
    async (tool) => {
      const others = new Set(
        AI_GATED_FEATURES.filter(
          (f) => f !== AI_TOOL_FEATURE[tool as keyof typeof AI_TOOL_FEATURE],
        ),
      );
      const box = tools().toolbox(SELLER, () => OCT_15, { features: others });
      expect(box.definitions.map((t) => t.function.name)).not.toContain(tool);
      expect(await box.call(tool, '{}')).toEqual({
        ok: false,
        error: `Неизвестный инструмент: ${tool}`,
      });
      const open = tools().toolbox(SELLER, () => OCT_15, { features: ALL_OPEN });
      expect(open.definitions.map((t) => t.function.name)).toContain(tool);
    },
  );

  it('фичи площадок ozon/wb входят в AI_GATED_FEATURES, но не прячут ни одного инструмента', () => {
    expect(AI_GATED_FEATURES).toEqual(expect.arrayContaining([FEATURE.OZON, FEATURE.WB]));
    const closed = new Set(AI_GATED_FEATURES.filter((f) => f !== FEATURE.OZON && f !== FEATURE.WB));
    const names = (features: Set<TFeatureKey>) =>
      tools()
        .toolbox(SELLER, () => OCT_15, { features })
        .definitions.map((t) => t.function.name);
    expect(names(closed)).toEqual(names(ALL_OPEN));
    expect(names(closed)).toContain(AI_TOOL.COMPARE);
  });

  it('промпт говорит только о видимых инструментах', () => {
    const now = new Date('2026-10-18T09:00:00Z');
    expect(analystSystemPrompt(now)).not.toContain('getTaxYear');
    const prompt = analystSystemPrompt(now, new Set([AI_TOOL.TAX_YEAR]));
    expect(prompt).toContain('getTaxYear');
    expect(prompt).toContain('прогноз');
    expect(prompt).not.toContain('getPriceFor');
  });
});

describe('getCashflow', () => {
  it('те же числа, что FinanceCashflowService.build; расходы с подписью; ссылки на операции выплат', async () => {
    await seedSept();
    await expenses.create(SELLER, rent);
    const result = await call(AI_TOOL.CASHFLOW, { month: '2026-09' });
    const door = await cashflow.build(SELLER, SEPT, OCT_15);

    expect(result.ok).toBe(true);
    const data = result.data as unknown as {
      inflow: { payouts: { kopecks: number } };
      net: { kopecks: number };
      outflow: { expensesByCategory: { label: string; amount: { kopecks: number } }[] };
      payouts: { amount: { kopecks: number }; mismatch: boolean }[];
      receivable: { asOf: string; total: { kopecks: number } };
    };
    expect(data.inflow.payouts.kopecks).toBe(door.cashflow.inflow.payoutsKopecks);
    expect(data.net.kopecks).toBe(door.cashflow.netKopecks);
    expect(data.payouts.map((p) => p.amount.kopecks)).toEqual(
      door.cashflow.payouts.map((p) => p.kopecks),
    );
    expect(data.payouts.map((p) => p.mismatch)).toEqual(
      door.cashflow.payouts.map((p) => p.mismatch),
    );
    expect(data.receivable).toMatchObject({
      asOf: door.receivable.asOf,
      total: { kopecks: door.receivable.totalKopecks },
    });
    expect(data.outflow.expensesByCategory).toEqual([
      { key: 'rent', label: 'Аренда', amount: { kopecks: 3_000_000, rub: '30000.00' } },
    ]);
    expect(result.sourceRefs.source).toBe('finance:cashflow');
    expect(result.sourceRefs.operationCount).toBe(
      door.cashflow.payoutArticles.flatMap((a) => a.operationIds).length,
    );
  });

  it('журнал месяца не загружен — insufficientData, а не нули', async () => {
    await seedSept();
    expect(await call(AI_TOOL.CASHFLOW, { month: '2026-08' })).toEqual({
      ok: false,
      insufficientData: true,
      reason: NO_JOURNAL_TEXT,
    });
    expect((await call(AI_TOOL.CASHFLOW, { month: 'сентябрь' })).error).toBe(
      'Месяц: нужен ГГГГ-ММ',
    );
  });
});

describe('getTaxYear', () => {
  it('те же числа, что FinanceTaxYearService.build; прогноз помечен «прогноз»', async () => {
    await seedSept();
    const result = await call(AI_TOOL.TAX_YEAR, {});
    const door = await taxYear.build(SELLER, 2026, OCT_15);

    expect(result.ok).toBe(true);
    const data = result.data as unknown as {
      year: number;
      incomeSinceYearStart: { kopecks: number };
      periods: {
        period: string;
        label: string;
        advance: { kopecks: number };
        due: { kopecks: number };
      }[];
      balance: { kopecks: number };
      forecast: { kind: string; income: { kopecks: number } };
      monthsNotLoaded: string[];
    };
    expect(data.year).toBe(2026);
    expect(data.incomeSinceYearStart.kopecks).toBe(door.taxYear.incomeKopecks);
    expect(data.periods.map((p) => [p.period, p.advance.kopecks, p.due.kopecks])).toEqual(
      door.taxYear.periods.map((p) => [p.key, p.advanceKopecks, p.dueKopecks]),
    );
    expect(data.periods.find((p) => p.period === 'm9')?.label).toBe('9 месяцев');
    expect(data.balance.kopecks).toBe(door.taxYear.balanceKopecks);
    expect(data.forecast).toEqual({
      kind: 'прогноз',
      income: expect.objectContaining({ kopecks: door.taxYear.forecast.incomeKopecks }),
      basisDays: door.taxYear.forecast.basisDays,
    });
    // Загружен один сентябрь — остальные месяцы модель обязана оговорить.
    expect(data.monthsNotLoaded).toContain('2026-08');
    expect(data.monthsNotLoaded).not.toContain('2026-09');
  });

  it('журнала за год нет — insufficientData; год вне окна — ошибка аргумента', async () => {
    expect(await call(AI_TOOL.TAX_YEAR, {})).toEqual({
      ok: false,
      insufficientData: true,
      reason: NO_TAX_JOURNAL_TEXT,
    });
    expect((await call(AI_TOOL.TAX_YEAR, { year: 2015 })).error).toBe(TAX_YEAR_ARG_INVALID_TEXT);
  });
});

describe('getPriceFor', () => {
  it('цена — priceFor над той же строкой ставок, что «Калькулятор цен»', async () => {
    await seedSept();
    const result = await call(AI_TOOL.PRICE, { sku: 'A1', targetMarginPercent: 20 });
    const kinds = new CrmPriceCalcKinds({ register: vi.fn() } as never, rates, {} as never);
    const screen = (
      await kinds.rates(
        { telegramUserId: SELLER, store: store as never, params: {}, features: {} },
        OCT_15,
      )
    ).data as ICrmPriceCalcRates;
    const a1 = screen.skus.find((s) => s.sku === 'A1');
    const expected = priceFor(
      { kind: 'margin', rate: 0.2 },
      {
        discountRate: 0,
        ...a1.rates,
        cogsKopecks: a1.cogsKopecks,
        tax: { mode: screen.tax.mode, rate: screen.tax.rate, minRate: screen.tax.minRate },
      },
    );

    expect(result.ok).toBe(true);
    expect(expected.ok).toBe(true);
    const data = result.data as unknown as {
      kind: string;
      price: { kopecks: number };
      perUnit: { marginPercent: number; cogs: { kopecks: number } };
      rates: { source: string; cogsSource: string };
    };
    expect(data.price.kopecks).toBe((expected as { priceKopecks: number }).priceKopecks);
    expect(data.perUnit.cogs.kopecks).toBe(150_000);
    expect(data.perUnit.marginPercent).toBeGreaterThanOrEqual(20);
    expect(data.kind).toBe('расчёт');
    expect(data.rates).toMatchObject({
      source: screen.sourceLabels[a1.ratesSource],
      cogsSource: 'закуп из прайса',
    });
  });

  it('нет решения — причина словами калькулятора, а не 0', async () => {
    await seedSept();
    expect(await call(AI_TOOL.PRICE, { sku: 'A1', targetMarginPercent: 95 })).toEqual({
      ok: false,
      insufficientData: true,
      reason: PRICE_CALC_FAILURE_TEXT.target,
    });
    expect(
      await call(AI_TOOL.PRICE, { sku: 'A1', targetProfitRub: 100, discountPercent: 100 }),
    ).toEqual({ ok: false, insufficientData: true, reason: PRICE_CALC_FAILURE_TEXT.discount });
  });

  it('нет ставок или закупа — insufficientData с причиной; цель — ровно одна', async () => {
    expect(await call(AI_TOOL.PRICE, { sku: 'A1', targetProfitRub: 500 })).toEqual({
      ok: false,
      insufficientData: true,
      reason: NO_PRICE_RATES_TEXT('A1'),
    });
    await seedSept();
    // Товар без продаж и без прайса: ставки — средние аккаунта, а закупа нет.
    expect(await call(AI_TOOL.PRICE, { sku: 'Z9', targetProfitRub: 500 })).toEqual({
      ok: false,
      insufficientData: true,
      reason: NO_PRICE_COGS_TEXT('Z9'),
    });
    expect((await call(AI_TOOL.PRICE, { sku: 'A1' })).error).toBe(PRICE_TARGET_INVALID_TEXT);
    expect(
      (await call(AI_TOOL.PRICE, { sku: 'A1', targetProfitRub: 1, targetMarginPercent: 1 })).error,
    ).toBe(PRICE_TARGET_INVALID_TEXT);
  });
});

describe('getExpenses', () => {
  it('те же числа, что allocatedFor, по категориям с подписью', async () => {
    await expenses.create(SELLER, rent);
    await expenses.create(SELLER, {
      kind: 'one_off',
      category: 'packaging',
      amount: '1 200',
      fromDay: '2026-09-10',
    });
    const result = await call(AI_TOOL.EXPENSES, { from: SEPT.from, to: SEPT.to });
    const door = await expenses.allocatedFor(SELLER, SEPT);

    expect(result.ok).toBe(true);
    const data = result.data as unknown as {
      total: { kopecks: number };
      byCategory: { key: string; label: string; amount: { kopecks: number } }[];
    };
    expect(data.total.kopecks).toBe(door.totalKopecks);
    expect(data.byCategory.map((c) => [c.key, c.label, c.amount.kopecks])).toEqual([
      ['rent', 'Аренда', door.byCategory.rent],
      ['packaging', 'Упаковка', door.byCategory.packaging],
    ]);
  });

  it('за период ничего не внесено — insufficientData; кривой период — ошибка', async () => {
    expect(await call(AI_TOOL.EXPENSES, { from: SEPT.from, to: SEPT.to }, EMPTY)).toEqual({
      ok: false,
      insufficientData: true,
      reason: NO_EXPENSES_TEXT,
    });
    expect((await call(AI_TOOL.EXPENSES, { from: SEPT.to, to: SEPT.from })).ok).toBe(false);
  });
});
