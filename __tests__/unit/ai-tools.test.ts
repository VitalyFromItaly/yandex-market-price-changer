import type { IAiToolResult } from '../../src/modules/ai/ai-tools.types';
import type { TFinancePeriodStatus } from '../../src/modules/finance/finance-period-status';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceAnomalyRepository } from '../../src/database/postgres/repositories/finance-anomaly.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import {
  AI_TOOL,
  AI_TOOL_DEFINITIONS,
  ANOMALIES_NOT_CHECKED_TEXT,
  BRAND_INVALID_TEXT,
  MAX_REF_IDS,
  NO_COST_NOTE,
  NO_JOURNAL_TEXT,
  OPERATIONS_NOT_FOUND_TEXT,
  TOOL_FAILED_TEXT,
  parseToolArgs,
  sourceRefs,
} from '../../src/modules/ai-tools/ai-tools.domain';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceScreenService } from '../../src/modules/finance/finance-screen.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Инструменты ИИ (TASK-147) на PGlite: журнал пишется настоящими репозиториями,
 * P&L считает настоящий FinanceService, Mongo-двери — заглушки. Главное, что
 * проверяется: продавец берётся из набора, а не из аргументов, и чужие данные
 * не видны ни одним инструментом.
 */

const SELLER = '111';
const OTHER = '222';
const SEPT = monthPeriod(2026, 9);
const SEPT_KEY = financePeriodKey('united-netting', SEPT);
const OCT_15 = new Date('2026-10-15T09:00:00Z');
const SEPT_ARGS = JSON.stringify({ from: SEPT.from, to: SEPT.to });

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

let test: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let anomalies: FinanceAnomalyRepository;

const errors = { report: vi.fn() };
const store = { telegramUserId: SELLER, commissionPercent: 23, taxPercent: 7, discountPercent: 0 };
/** Каталог двух продавцов — поиск обязан видеть только своего. */
const CATALOG = [
  { telegramUserId: SELLER, internalSku: 'A1', name: 'Casio F-91W', marketplaceSkus: { ym: 'A1' } },
  { telegramUserId: SELLER, internalSku: 'C2', name: 'Casio A158', marketplaceSkus: { ym: 'C2' } },
  { telegramUserId: SELLER, internalSku: 'OFF', name: 'Casio F-91W коробка' },
  { telegramUserId: OTHER, internalSku: 'Z9', name: 'Casio F-91W', marketplaceSkus: { ym: 'Z9' } },
];
/** Артикулы с закупом в заглушке прайса. */
let costed = new Set(['A1']);
const products = {
  search: vi.fn(async (uid: string, query: string, limit: number) => {
    const words = query.toLowerCase().split(/\s+/);
    const found = CATALOG.filter(
      (p) => p.telegramUserId === uid && words.every((w) => p.name.toLowerCase().includes(w)),
    );
    return { items: found.slice(0, limit), total: found.length };
  }),
  findByYmSkus: vi.fn(async (_uid: string, skus: string[]) =>
    [
      { name: 'Casio F-91W', marketplaceSkus: { ym: 'A1' } },
      { name: 'Casio A158', marketplaceSkus: { ym: 'C2' } },
      { name: 'Seiko 5', marketplaceSkus: { ym: 'S1' } },
    ].filter((p) => skus.includes(p.marketplaceSkus.ym)),
  ),
};

function tools(finance?: FinanceService) {
  const engine =
    finance ??
    new FinanceService(
      operations,
      periods,
      new FinanceTaxService(new FinanceTaxSettingsRepository(test.db)),
      new FinanceExpensesService(new FinanceExpenseRepository(test.db)),
      { findByTelegramUser: async () => store } as never,
      {
        findBySkus: async (_user: string, skus: string[]) =>
          new Map(skus.filter((s) => costed.has(s)).map((s) => [s, { price: 1500 }])),
      } as never,
      { findForSkus: async () => new Map() } as never,
      { build: vi.fn() } as never,
      errors as never,
    );
  const screen = new FinanceScreenService(
    operations,
    documents,
    periods,
    new FinanceDiscrepancyRepository(test.db),
    new FinanceCorrectionRepository(test.db),
    anomalies,
  );
  return new AiToolsService(engine, screen, products as never, errors as never);
}

async function seed(rows: Record<string, unknown>[], telegramUserId = SELLER) {
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    buffer: Buffer.from(`v-${telegramUserId}`),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  const keys = journalKeys(rows);
  const ops = rows.map((r, i) =>
    nettingRowToOperation(r, keys[i], {
      telegramUserId,
      businessId: 'b1',
      documentId: document.id,
      documentVersion: document.version,
      periodKey: SEPT_KEY,
    }),
  );
  await operations.upsertMany(ops);
  await setStatus('verified', telegramUserId);
  return { document };
}

async function setStatus(status: TFinancePeriodStatus, telegramUserId = SELLER) {
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId,
    reportType: 'united-netting',
    periodKey: SEPT_KEY,
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    checkedAt: new Date(),
    status,
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

async function liveIds(telegramUserId: string): Promise<string[]> {
  const from = new Date('2026-08-31T21:00:00Z');
  const to = new Date('2026-09-30T21:00:00Z');
  return (await operations.liveForPnl(telegramUserId, from, to)).map((op) => op.id);
}

const call = (service: AiToolsService, uid: string, name: string, args: unknown) =>
  service
    .toolbox(uid, () => OCT_15)
    .call(name, typeof args === 'string' ? args : JSON.stringify(args));

function expectRefs(result: IAiToolResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.sourceRefs.source).toMatch(/^(finance|products):/);
  expect(Array.isArray(result.sourceRefs.operationIds)).toBe(true);
  expect(result.sourceRefs.operationCount).toBeGreaterThanOrEqual(
    result.sourceRefs.operationIds.length,
  );
}

beforeAll(async () => {
  test = await createTestFinanceDb();
  operations = new FinanceOperationRepository(test.db);
  documents = new FinanceDocumentRepository(test.db);
  periods = new FinancePeriodRepository(test.db);
  anomalies = new FinanceAnomalyRepository(test.db);
}, 60_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await test.reset();
  errors.report.mockReset();
  products.findByYmSkus.mockClear();
  products.search.mockClear();
  costed = new Set(['A1']);
});

describe('схемы инструментов', () => {
  it('все инструменты, и ни у одного нет аргумента продавца', () => {
    expect(AI_TOOL_DEFINITIONS.map((t) => t.function.name).sort()).toEqual(
      Object.values(AI_TOOL).sort(),
    );
    for (const tool of AI_TOOL_DEFINITIONS) {
      const params = tool.function.parameters as {
        properties: object;
        additionalProperties: boolean;
      };
      expect(params.additionalProperties).toBe(false);
      expect(Object.keys(params.properties).join(' ')).not.toMatch(/user|seller|telegram/i);
    }
  });

  it('аргументы: не JSON, не объект, лишнее поле — отказ', () => {
    expect(parseToolArgs('{', ['a'])).toBe('Аргументы не JSON');
    expect(parseToolArgs('[1]', ['a'])).toBe('Аргументы — не объект');
    expect(parseToolArgs('{"a":1,"telegramUserId":"222"}', ['a'])).toMatch(/telegramUserId/);
    expect(parseToolArgs('', ['a'])).toEqual({});
  });

  it('sourceRefs: уникальные id, первые MAX_REF_IDS, полный счёт отдельно', () => {
    const ids = Array.from({ length: MAX_REF_IDS + 5 }, (_, i) => `id${i}`);
    const refs = sourceRefs('finance:pnl', SEPT, [ids, ['id0']], ['d1', null, 'd1']);
    expect(refs.operationIds).toHaveLength(MAX_REF_IDS);
    expect(refs.operationCount).toBe(MAX_REF_IDS + 5);
    expect(refs.documentIds).toEqual(['d1']);
    expect(refs.period).toEqual(SEPT);
  });
});

describe('AiToolsService', () => {
  it('getPnl: числа движка со ссылками на операции периода', async () => {
    await seed([row(), row({ orderId: 2, transactionSum: 3000, count: 1 })]);
    const result = await call(tools(), SELLER, AI_TOOL.PNL, SEPT_ARGS);

    expectRefs(result);
    if (!result.ok) return;
    const data = result.data as { levels: { revenue: { kopecks: number } }; statusLabel: string };
    expect(data.levels.revenue.kopecks).toBe(800_000);
    expect(result.sourceRefs.operationIds.sort()).toEqual((await liveIds(SELLER)).sort());
  });

  it('продавец — из набора: чужой журнал не виден ни P&L, ни операциями', async () => {
    await seed([row()], OTHER);
    const otherIds = await liveIds(OTHER);
    const service = tools();

    expect(await call(service, SELLER, AI_TOOL.PNL, SEPT_ARGS)).toEqual({
      ok: false,
      insufficientData: true,
      reason: NO_JOURNAL_TEXT,
    });
    expect(await call(service, SELLER, AI_TOOL.OPERATIONS, { ids: otherIds })).toEqual({
      ok: false,
      insufficientData: true,
      reason: OPERATIONS_NOT_FOUND_TEXT,
    });
    // Попытка передать продавца аргументом — отказ, а не молчаливое игнорирование.
    const sneaky = await call(service, SELLER, AI_TOOL.PNL, {
      from: SEPT.from,
      to: SEPT.to,
      telegramUserId: OTHER,
    });
    expect(sneaky).toMatchObject({ ok: false, error: expect.stringMatching(/telegramUserId/) });
    // Владелец свои операции видит.
    expectRefs(await call(service, OTHER, AI_TOOL.OPERATIONS, { ids: otherIds }));
  });

  it('getOperations: поля журнала, ссылки на документ', async () => {
    const { document } = await seed([row()]);
    const ids = await liveIds(SELLER);
    const result = await call(tools(), SELLER, AI_TOOL.OPERATIONS, { ids });

    expectRefs(result);
    if (!result.ok) return;
    expect(result.sourceRefs.documentIds).toEqual([document.id]);
    expect(
      (result.data as { operations: { amount: { rub: string } }[] }).operations[0].amount.rub,
    ).toBe('5000.00');
    expect(await call(tools(), SELLER, AI_TOOL.OPERATIONS, { ids: ['не-uuid'] })).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  });

  it('getSkuEconomics: строка разреза и имя товара; нет такого — insufficientData', async () => {
    await seed([row(), row({ orderId: 2, shopSku: 'B2', transactionSum: 1000, count: 1 })]);
    const service = tools();
    const result = await call(service, SELLER, AI_TOOL.SKU, { sku: 'A1', ...SEPT });

    expectRefs(result);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      sku: 'A1',
      name: 'Casio F-91W',
      units: 2,
      costKnown: true,
    });
    expect(result.sourceRefs.operationCount).toBe(1);

    expect(await call(service, SELLER, AI_TOOL.SKU, { sku: 'ZZZ', ...SEPT })).toMatchObject({
      ok: false,
      insufficientData: true,
    });
  });

  it('getBrandEconomics: бренд — сумма его товаров со ссылками; без brand — все бренды', async () => {
    await seed([
      row(),
      row({ orderId: 2, shopSku: 'C2', transactionSum: 1000, count: 1 }),
      row({ orderId: 3, shopSku: 'S1', transactionSum: 2000, count: 1 }),
      row({ orderId: 4, shopSku: 'X9', transactionSum: 700, count: 1 }),
    ]);
    const service = tools();
    const casio = await call(service, SELLER, AI_TOOL.BRAND, { brand: 'casio', ...SEPT });

    expectRefs(casio);
    if (!casio.ok) return;
    const data = casio.data as {
      title: string;
      skus: number;
      units: number;
      costKnown: boolean;
      columns: { revenue: { kopecks: number } };
      topItems: { sku: string }[];
    };
    expect(data).toMatchObject({ title: 'CASIO', skus: 2, units: 3, costKnown: false });
    expect(data.columns.revenue.kopecks).toBe(600_000);
    expect(data.topItems.map((i) => i.sku).sort()).toEqual(['A1', 'C2']);
    expect(casio.sourceRefs.operationCount).toBe(2);
    expect(casio.sourceRefs.label).toContain('CASIO');

    const all = await call(service, SELLER, AI_TOOL.BRAND, SEPT_ARGS);
    expectRefs(all);
    if (!all.ok) return;
    const brands = (
      all.data as { brands: { brand: string; columns: { revenue: { kopecks: number } } }[] }
    ).brands;
    expect(brands.map((b) => b.brand)).toEqual(['casio', 'seiko', 'other']);
    expect(brands.reduce((sum, b) => sum + b.columns.revenue.kopecks, 0)).toBe(870_000);

    expect(await call(service, SELLER, AI_TOOL.BRAND, { brand: 'orient', ...SEPT })).toMatchObject({
      ok: false,
      insufficientData: true,
    });
    expect(await call(service, SELLER, AI_TOOL.BRAND, { brand: 'rolex', ...SEPT })).toEqual({
      ok: false,
      error: BRAND_INVALID_TEXT,
    });
  });

  it('searchProducts: товары своего продавца по части названия; чужие не видны', async () => {
    const service = tools();
    const result = await call(service, SELLER, AI_TOOL.SEARCH, { query: 'f-91w' });

    expectRefs(result);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      query: 'f-91w',
      total: 2,
      products: [
        { sku: 'A1', name: 'Casio F-91W', internalSku: 'A1' },
        { sku: null, internalSku: 'OFF' },
      ],
    });
    expect(products.search).toHaveBeenCalledWith(SELLER, 'f-91w', 10);
    // Ссылок на операции у справочника нет — экран их не покажет.
    expect(result.sourceRefs.operationCount).toBe(0);

    const other = await call(service, OTHER, AI_TOOL.SEARCH, { query: 'A158' });
    expect(products.search).toHaveBeenLastCalledWith(OTHER, 'A158', 10);
    expect(other).toMatchObject({ ok: false, insufficientData: true });
    expect((other as { reason: string }).reason).toContain('A158');

    const forged = await call(service, SELLER, AI_TOOL.SEARCH, {
      query: 'casio',
      telegramUserId: OTHER,
    });
    expect(forged).toMatchObject({ ok: false, error: expect.stringContaining('telegramUserId') });
    expect(await call(service, SELLER, AI_TOOL.SEARCH, { query: 'a' })).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
    expect(
      await call(service, SELLER, AI_TOOL.SEARCH, { query: 'casio', limit: 21 }),
    ).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('getTopSkus: рейтинг по строкам разреза, без закупа — вне рейтинга прибыли', async () => {
    costed = new Set(['A1', 'C2']);
    await seed([
      row(), // A1: 2 шт. за 5000 при закупе 1500 — прибыль
      row({ orderId: 2, shopSku: 'C2', transactionSum: 1000, count: 1 }), // закуп 1500 — убыток
      row({ orderId: 3, shopSku: 'S1', transactionSum: 2000, count: 1 }), // без закупа
    ]);
    const service = tools();
    type TTop = {
      items: { sku: string; name: string | null; net: { kopecks: number } }[];
      excludedNoCost?: { count: number; note: string };
    };

    const best = await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'net' });
    expectRefs(best);
    if (!best.ok) return;
    const bestData = best.data as TTop;
    expect(bestData.items.map((i) => i.sku)).toEqual(['A1', 'C2']);
    expect(bestData.items[0].name).toBe('Casio F-91W');
    expect(bestData.excludedNoCost).toEqual({ count: 1, note: NO_COST_NOTE });

    const worst = await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'net', order: 'asc' });
    expect((worst as { data: TTop }).data.items.map((i) => i.sku)).toEqual(['C2', 'A1']);

    const loss = await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'net', lossOnly: true });
    expectRefs(loss);
    if (!loss.ok) return;
    const lossData = loss.data as TTop;
    expect(lossData.items.map((i) => i.sku)).toEqual(['C2']);
    expect(lossData.items[0].net.kopecks).toBeLessThan(0);

    // Выручка от закупа не зависит — товар без закупа в рейтинге остаётся.
    const revenue = await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'revenue' });
    const revenueData = (revenue as { data: TTop }).data;
    expect(revenueData.items.map((i) => i.sku)).toEqual(['A1', 'S1', 'C2']);
    expect(revenueData.excludedNoCost).toBeUndefined();

    expect(await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'profit' })).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  });

  it('getTopSkus: числа строки == getSkuEconomics того же товара до копейки', async () => {
    await seed([row(), row({ orderId: 2, shopSku: 'B2', transactionSum: 1000, count: 1 })]);
    const service = tools();
    const top = await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'net', limit: 1 });
    const sku = await call(service, SELLER, AI_TOOL.SKU, { sku: 'A1', ...SEPT });
    if (!top.ok || !sku.ok) throw new Error('ожидались данные');

    type TMoney = { kopecks: number };
    const item = (top.data as { items: Record<string, unknown>[] }).items[0] as {
      sku: string;
      revenue: TMoney;
      net: TMoney;
      cogs: TMoney;
      units: number;
    };
    const one = sku.data as {
      columns: { revenue: TMoney };
      net: TMoney;
      cogs: TMoney;
      units: number;
    };
    expect(item.sku).toBe('A1');
    expect(item.revenue.kopecks).toBe(one.columns.revenue.kopecks);
    expect(item.net.kopecks).toBe(one.net.kopecks);
    expect(item.cogs.kopecks).toBe(one.cogs.kopecks);
    expect(item.units).toBe(one.units);
    expect(top.sourceRefs.operationIds).toEqual(sku.sourceRefs.operationIds);

    // B2 без закупа: убыточных с подтверждённым закупом нет — причина, а не пустой список.
    const loss = await call(service, SELLER, AI_TOOL.TOP, { ...SEPT, by: 'net', lossOnly: true });
    expect(loss).toMatchObject({ ok: false, insufficientData: true });
    expect((loss as { reason: string }).reason).toContain('без закупа и вне рейтинга — 1');
  });

  it('compareMarketplaces: ЯМ — числа, Ozon и WB — insufficientData, а не нули', async () => {
    await seed([row()]);
    const result = await call(tools(), SELLER, AI_TOOL.COMPARE, SEPT_ARGS);

    expectRefs(result);
    if (!result.ok) return;
    const list = (result.data as { marketplaces: Record<string, unknown>[] }).marketplaces;
    expect(list.find((m) => m.marketplace === 'ym')).toHaveProperty('levels');
    for (const mp of ['ozon', 'wb']) {
      const item = list.find((m) => m.marketplace === mp);
      expect(item).toMatchObject({ insufficientData: true });
      expect(item).not.toHaveProperty('levels');
    }
    expect(
      await call(tools(), SELLER, AI_TOOL.PNL, { ...SEPT, marketplace: 'ozon' }),
    ).toMatchObject({ ok: false, insufficientData: true });
  });

  it('listAnomalies: не проверялся — insufficientData; проверен — список со ссылками', async () => {
    await seed([row()]);
    const service = tools();
    expect(await call(service, SELLER, AI_TOOL.ANOMALIES, { month: '2026-09' })).toEqual({
      ok: false,
      insufficientData: true,
      reason: ANOMALIES_NOT_CHECKED_TEXT,
    });

    const [opId] = await liveIds(SELLER);
    const scope = { marketplace: 'ym' as const, telegramUserId: SELLER, periodKey: SEPT_KEY };
    await anomalies.replacePeriod(
      scope,
      [
        {
          kind: 'penalty',
          key: 'penalty:sept:1',
          fingerprint: 'f1',
          operationIds: [opId],
          operationCount: 1,
          amountKopecks: -50_000,
          sku: 'A1',
          orderId: '1',
          threshold: 'любой штраф',
          detail: 'Штраф за опоздание',
        },
      ],
      OCT_15,
    );
    const result = await call(service, SELLER, AI_TOOL.ANOMALIES, { month: '2026-09' });
    expectRefs(result);
    if (!result.ok) return;
    expect(result.sourceRefs.operationIds).toEqual([opId]);
    // Чужой продавец того же месяца аномалий не видит.
    expect(await call(service, OTHER, AI_TOOL.ANOMALIES, { month: '2026-09' })).toMatchObject({
      insufficientData: true,
    });
  });

  it('кривой период, неизвестный инструмент — ошибка модели, не исключение', async () => {
    const service = tools();
    expect(
      await call(service, SELLER, AI_TOOL.PNL, { from: '2026-09-31', to: '2026-09-30' }),
    ).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await call(service, SELLER, 'dropTables', {})).toMatchObject({ ok: false });
    expect(() => service.toolbox('')).toThrow(/telegramUserId/);
  });

  it('сбой движка — журнал ErrorReporter и честный отказ модели', async () => {
    const broken = { build: vi.fn().mockRejectedValue(new Error('postgres down')) };
    const result = await call(tools(broken as never), SELLER, AI_TOOL.PNL, SEPT_ARGS);
    expect(result).toEqual({ ok: false, error: TOOL_FAILED_TEXT });
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ai', context: 'ai-tool:getPnl', telegramUserId: SELLER }),
    );
  });
});
