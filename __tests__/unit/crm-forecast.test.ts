import type {
  ICrmForecast,
  ICrmForecastPurchases,
} from '../../src/modules/crm/forecast/crm-forecast.domain';
import type { IFinancePeriod } from '../../src/modules/finance/finance-period';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ymStockLevels } from '../../src/modules/marketplaces/marketplace-stocks';

/** Остатки кампании FBS так, как их отдаёт адаптер ЯМ (TASK-163). */
const ymLevels = (stocks: Record<string, number>) =>
  ymStockLevels({ placement: 'FBS', takenAt: new Date(), stocks });

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { AI_TOOL } from '../../src/modules/ai-tools/ai-tools.domain';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import {
  FORECAST_KIND,
  FORECAST_PURCHASES_KIND,
} from '../../src/modules/crm/forecast/crm-forecast.domain';
import { CrmForecastKinds } from '../../src/modules/crm/forecast/crm-forecast.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { FinanceForecastService } from '../../src/modules/finance/finance-forecast.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { FORECAST_NO_JOURNAL } from '../../src/modules/finance/forecast';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  FEATURE,
  FEATURE_META,
  isFeatureEnabled,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Прогнозы» CRM (TASK-151): факт и база — тот же `FinanceService.build`, что
 * «Финансы», поэтому прогноз сверяется с ним до копейки; ИИ-инструмент
 * `getForecast` отдаёт ровно числа kind-а и виден только при открытой фиче.
 */

const SELLER = '333';
const SEPT = monthPeriod(2026, 9);
const OCT = monthPeriod(2026, 10);
const OCT_17 = new Date('2026-10-17T09:00:00Z');

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
  paymentStatus: null,
  bankOrderId: null,
  bankOrderDate: null,
  bankSum: null,
  model: 'FBS',
  ...over,
});

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let finance: FinanceService;
let forecasts: FinanceForecastService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  periods = new FinancePeriodRepository(pg.db);
  const expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  const taxes = new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db));
  finance = new FinanceService(
    operations,
    periods,
    taxes,
    expenses,
    { findByTelegramUser: async () => null } as never,
    { findBySkus: async () => new Map([['A1', { price: 3000 }]]) } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
  const cashflow = new FinanceCashflowService(
    operations,
    expenses,
    new FinancePurchasesService(new FinancePurchaseRepository(pg.db)),
  );
  forecasts = new FinanceForecastService(finance, cashflow, taxes);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
});

async function seed(rows: Record<string, unknown>[], period: IFinancePeriod) {
  const periodKey = financePeriodKey('united-netting', period);
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
        periodKey,
      }),
    ),
  );
  // Без строки статуса журнал считается «не загружен».
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId: SELLER,
    reportType: 'united-netting',
    periodKey,
    periodFrom: period.from,
    periodTo: period.to,
    checkedAt: new Date(),
    status: 'preliminary',
    lastOutcome: 'imported',
    documentVersion: document.version,
    unknownCount: 0,
    changedCount: 0,
    removedCount: 0,
    discrepancyCount: 0,
    reconcileState: 'not_checked',
    reconcileNote: null,
    error: null,
  });
}

async function seedBoth() {
  await seed(
    [
      row({ orderId: 1, transactionDate: '20.09.2026 10:00' }),
      row({ orderId: 2, transactionDate: '25.09.2026 10:00' }),
      row({
        orderId: 2,
        shopSku: null,
        transactionType: 'Удержание',
        transactionSource: 'Оплата услуг Маркета',
        offerOrServiceName: 'Размещение товарных предложений',
        transactionSum: -1000,
        count: null,
        transactionDate: '25.09.2026 10:00',
      }),
    ],
    SEPT,
  );
  await seed(
    [
      row({ orderId: 3, transactionDate: '05.10.2026 10:00' }),
      row({ orderId: 4, count: 2, transactionSum: 10000, transactionDate: '12.10.2026 10:00' }),
    ],
    OCT,
  );
}

const contextOf = (params: Record<string, unknown>, store: Record<string, unknown> = {}) =>
  ({ telegramUserId: SELLER, store: store as never, params, features: {} }) as const;

function kinds(listStocks = vi.fn(async () => ymLevels({ A1: 3 }))) {
  const register = vi.fn();
  const instance = new CrmForecastKinds(
    { register } as never,
    forecasts,
    finance,
    { require: () => ({ listStocks }) } as never,
    { findBySkus: async () => new Map([['A1', { price: 3000 }]]) } as never,
    { findByYmSkus: async () => [{ marketplaceSkus: { ym: 'A1' }, name: 'Casio F-91W' }] } as never,
  );
  return { instance, register, listStocks };
}

describe('«Прогнозы» = «Финансам» по построению', () => {
  it('факт месяца и база — те же P&L; прогноз = факт + база / N × оставшиеся', async () => {
    await seedBoth();
    const { data } = await kinds().instance.summary(contextOf({ basisDays: 28 }), OCT_17);
    const view = data as ICrmForecast;
    expect(view.basisDays).toBe(28);
    expect(view.today).toBe('2026-10-17');
    expect(view.reason).toBeNull();

    const fact = await finance.build(SELLER, { from: '2026-10-01', to: '2026-10-16' }, OCT_17, {
      flat: false,
    });
    const basis = await finance.build(SELLER, { from: '2026-09-19', to: '2026-10-16' }, OCT_17, {
      flat: false,
    });
    const f = view.forecast;
    expect(f.month.fact.revenueKopecks).toBe(fact.pnl.revenueKopecks);
    expect(f.month.fact.netKopecks).toBe(fact.pnl.netKopecks);
    expect(f.month.forecast.revenueKopecks).toBe(
      fact.pnl.revenueKopecks + Math.round((basis.pnl.revenueKopecks * 15) / 28),
    );
    expect(f.month.forecast.netKopecks).toBe(
      fact.pnl.netKopecks + Math.round((basis.pnl.netKopecks * 15) / 28),
    );
    // Строки не выплачены — всё начисленное до сегодня «к получению».
    expect(f.inflow.receivableKopecks).toBe(
      basis.pnl.afterMarketplaceKopecks + basis.pnl.cogs.kopecks,
    );
    expect(f.tax).toEqual({ regime: 'usn_income', rateBasisPoints: 600 });
    expect(f.taxIsDefault).toBe(true);
  });

  it('журнала месяца окна нет — причина, а не нули', async () => {
    await seed([row({ orderId: 3, transactionDate: '05.10.2026 10:00' })], OCT);
    const { data } = await kinds().instance.summary(contextOf({}), OCT_17);
    expect(data).toMatchObject({
      basisDays: 28,
      forecast: null,
      reason: FORECAST_NO_JOURNAL('09.2026'),
    });
  });

  it('мусор в параметрах — CrmJobError', async () => {
    const { instance } = kinds();
    await expect(instance.summary(contextOf({ basisDays: 30 }), OCT_17)).rejects.toBeInstanceOf(
      CrmJobError,
    );
    await expect(
      instance.purchases(contextOf({ basisDays: 28, coverDays: 500 }), OCT_17),
    ).rejects.toBeInstanceOf(CrmJobError);
  });
});

describe('закупки', () => {
  it('скорость из окна базы, остатки — сумма по магазинам; сбой магазина — строка с причиной', async () => {
    await seedBoth();
    const listStocks = vi
      .fn()
      .mockResolvedValueOnce(ymLevels({ A1: 1 }))
      .mockRejectedValueOnce(new Error('boom'));
    const { instance } = kinds(listStocks);
    const store = {
      telegramUserId: SELLER,
      stores: [
        { campaignId: 'c1', businessId: 'b1', storeName: 'FBS' },
        { campaignId: 'c2', businessId: 'b1', storeName: 'FBY' },
      ],
    };
    const { data } = await instance.purchases(
      contextOf({ basisDays: 28, coverDays: 28 }, store),
      OCT_17,
    );
    const view = data as ICrmForecastPurchases;
    expect(view.stores).toBe(2);
    expect(view.problems).toHaveLength(1);
    expect(view.problems[0].storeName).toBe('FBY');
    // В окне 20.09…16.10 продано 1 + 1 + 1 + 2 = 5 шт.: за 28 дней запаса — 5, есть 1.
    expect(view.rows).toEqual([
      expect.objectContaining({ sku: 'A1', name: 'Casio F-91W', stock: 1, needUnits: 4 }),
    ]);
    // Закуп — прайс 3 000 ₽ минус общая скидка по умолчанию 10 %, как в «Обзоре».
    expect(view.totalKopecks).toBe(4 * 270_000);
  });
});

describe('фича и ИИ-инструмент', () => {
  it('оба kind-а — аккаунта, под forecast; фича выключена и требует «Финансы»', () => {
    const { instance, register } = kinds();
    instance.onModuleInit();
    expect(register.mock.calls.map(([kind, def]) => [kind, def.features, def.scope])).toEqual([
      [FORECAST_KIND, [FEATURE.FORECAST], 'account'],
      [FORECAST_PURCHASES_KIND, [FEATURE.FORECAST], 'account'],
    ]);
    expect(CRM_SECTIONS['ym-forecast']).toEqual([FEATURE.FORECAST]);
    expect(FEATURE_META[FEATURE.FORECAST]).toMatchObject({
      defaultEnabled: false,
      requires: [FEATURE.FINANCE],
    });
    expect(isFeatureEnabled({ [FEATURE.FORECAST]: true }, FEATURE.FORECAST)).toBe(false);
    expect(
      isFeatureEnabled({ [FEATURE.FORECAST]: true, [FEATURE.FINANCE]: true }, FEATURE.FORECAST),
    ).toBe(true);
  });

  const tools = () =>
    new AiToolsService(finance, {} as never, {} as never, { report: vi.fn() } as never, forecasts);

  it('без фичи getForecast не виден модели и не вызывается', async () => {
    const box = tools().toolbox(SELLER, () => OCT_17);
    expect(box.definitions.map((t) => t.function.name)).not.toContain(AI_TOOL.FORECAST);
    expect(await box.call(AI_TOOL.FORECAST, '{}')).toEqual({
      ok: false,
      error: `Неизвестный инструмент: ${AI_TOOL.FORECAST}`,
    });
  });

  it('с фичей — те же числа, что kind, метка «прогноз» и ссылка на окно базы', async () => {
    await seedBoth();
    const box = tools().toolbox(SELLER, () => OCT_17, { features: new Set([FEATURE.FORECAST]) });
    expect(box.definitions.map((t) => t.function.name)).toContain(AI_TOOL.FORECAST);
    const result = (await box.call(AI_TOOL.FORECAST, '{"basisDays":28}')) as {
      ok: true;
      data: {
        kind: string;
        month: { forecast: { revenue: { kopecks: number; rub: string } } };
        method: { text: string };
      };
      sourceRefs: { source: string; period: IFinancePeriod; operationCount: number; label: string };
    };
    const { data } = await kinds().instance.summary(contextOf({ basisDays: 28 }), OCT_17);
    const view = data as ICrmForecast;
    expect(result.ok).toBe(true);
    expect(result.data.kind).toBe('прогноз');
    expect(result.data.month.forecast.revenue.kopecks).toBe(
      view.forecast.month.forecast.revenueKopecks,
    );
    expect(result.data.method.text).toBe(view.forecast.method.text);
    expect(result.sourceRefs).toMatchObject({
      source: 'finance:forecast',
      period: { from: '2026-09-19', to: '2026-10-16' },
      operationCount: 5,
    });
    expect(result.sourceRefs.label).toContain('28');
    expect(await box.call(AI_TOOL.FORECAST, '{"basisDays":30}')).toMatchObject({ ok: false });
  });
});
