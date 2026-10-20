import type {
  IChatCompletionRequest,
  IChatCompletionResult,
} from '../../src/modules/ai/polza.client';
import type { IFinancePeriod } from '../../src/modules/finance/finance-period';
import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';

import { FinanceAnomalyRepository } from '../../src/database/postgres/repositories/finance-anomaly.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AiTurn } from '../../src/database/schemas/ai-turn.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AiTurnService } from '../../src/database/services/ai-turn.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AiFeatureDisabledError } from '../../src/modules/ai/ai.errors';
import { AiService } from '../../src/modules/ai/ai.service';
import { NO_JOURNAL_TEXT } from '../../src/modules/ai-tools/ai-tools.domain';
import {
  articleChangesOf,
  recommendationTagsOf,
  REVIEW_NO_PREVIOUS_TEXT,
  REVIEW_NO_RECOMMENDATIONS_TEXT,
} from '../../src/modules/ai-analyst/period-review.domain';
import { PeriodReviewService } from '../../src/modules/ai-analyst/period-review.service';
import { PeriodReviewTurns } from '../../src/modules/crm/ai-analyst/crm-ai-analyst.turns';
import {
  CrmAiPeriodReviewController,
  INVALID_MONTH,
} from '../../src/modules/crm/ai-analyst/crm-ai-period-review.controller';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { payoutArticlesOf } from '../../src/modules/finance/cashflow';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import {
  financePeriodKey,
  financeToday,
  monthPeriod,
} from '../../src/modules/finance/finance-period';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { parseScreenMonth, previousScreenMonth } from '../../src/modules/finance/finance-screen';
import { FinanceScreenService } from '../../src/modules/finance/finance-screen.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { COMPARE_TAX_NOTE } from '../../src/modules/finance/marketplace-compare';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «ИИ-разбор периода» (TASK-150): факты считает сервер из тех же дверей, что
 * «Финансы» (PGlite, настоящий FinanceService), модель — заглушка Polza. Главное:
 * числа фактов = P&L месяца, рекомендации — только кандидаты сервера со
 * ссылками, без журнала и без фичи `ai` модель не зовётся вовсе.
 */

const SELLER = '333';
const SEPT = monthPeriod(2026, 9);
const AUG = monthPeriod(2026, 8);
const OCT_15 = new Date('2026-10-15T09:00:00Z');
const MONTH = parseScreenMonth('2026-09');

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

const commission = (orderId: number, sum: number, date: string) =>
  row({
    orderId,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: 'Размещение товарных предложений',
    transactionSum: sum,
    transactionDate: date,
    count: null,
    paymentStatus: null,
    bankOrderId: null,
    bankOrderDate: null,
    bankSum: null,
  });

const RESULT: IChatCompletionResult = {
  content: '',
  toolCalls: [],
  finishReason: 'stop',
  usage: {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cachedTokens: 0,
    reasoningTokens: 0,
    costRub: 0.01,
  },
  model: 'm',
  provider: 'p',
  traceId: 't',
};

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let finance: FinanceService;
let cashflow: FinanceCashflowService;
let screen: FinanceScreenService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  periods = new FinancePeriodRepository(pg.db);
  const expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  cashflow = new FinanceCashflowService(
    operations,
    expenses,
    new FinancePurchasesService(new FinancePurchaseRepository(pg.db)),
  );
  finance = new FinanceService(
    operations,
    periods,
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    expenses,
    { findByTelegramUser: async () => null } as never,
    {
      // A1 — закуп 1 500 ₽ (прибыльный), B1 — 4 000 ₽ при продаже за 3 000 ₽ (убыточный).
      findBySkus: async () =>
        new Map([
          ['A1', { price: 1500 }],
          ['B1', { price: 4000 }],
        ]),
    } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
  screen = new FinanceScreenService(
    operations,
    documents,
    periods,
    new FinanceDiscrepancyRepository(pg.db),
    new FinanceCorrectionRepository(pg.db),
    new FinanceAnomalyRepository(pg.db),
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function seed(rows: Record<string, unknown>[], period: IFinancePeriod) {
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
  const periodKey = financePeriodKey('united-netting', period);
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
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId: SELLER,
    reportType: 'united-netting',
    periodKey,
    periodFrom: period.from,
    periodTo: period.to,
    checkedAt: new Date(),
    status: 'verified',
    lastOutcome: 'imported',
    documentVersion: document.version,
    unknownCount: 0,
    changedCount: 0,
    removedCount: 0,
    discrepancyCount: 0,
    reconcileState: 'checked',
    reconcileNote: null,
    error: null,
  });
}

async function seedBoth() {
  await seed(
    [
      row({ transactionDate: '16.08.2026 14:05', bankOrderId: 'P0', bankOrderDate: '20.08.2026' }),
      commission(1, -500, '16.08.2026 14:05'),
    ],
    AUG,
  );
  await seed(
    [
      row({ orderId: 2 }),
      commission(2, -2000, '16.09.2026 14:05'),
      row({
        orderId: 3,
        shopSku: 'B1',
        count: 1,
        transactionSum: 3000,
        bankOrderId: 'P2',
        bankSum: 3000,
      }),
    ],
    SEPT,
  );
}

function reviewer() {
  const chatCompletion = vi.fn();
  const usage = { record: vi.fn(), spentRubSince: vi.fn().mockResolvedValue(0) };
  const config = {
    polzaAiEnabled: true,
    polzaAiModel: 'm',
    polzaAiModelFor: () => 'm',
    aiUserDailyLimitRub: 50,
  };
  const ai = new AiService(
    { chatCompletion } as never,
    usage as never,
    config as never,
    { report: vi.fn() } as never,
  );
  const products = {
    findByYmSkus: async () => [{ marketplaceSkus: { ym: 'B1' }, name: 'Часы B1' }],
  };
  const turns = { record: vi.fn() };
  const service = new PeriodReviewService(
    ai,
    finance,
    cashflow,
    screen,
    products as never,
    turns as never,
  );
  return { service, chatCompletion, usage, turns };
}

/** Факты, которые модель получила, — JSON из сообщения пользователя. */
function factsOf(request: IChatCompletionRequest): any[] {
  const content = request.messages[1].content as string;
  return JSON.parse(content.slice(content.indexOf('\n') + 1));
}

describe('ИИ-разбор периода: факты и проверка ответа', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await pg.reset();
  });

  it('уровни фактов = P&L «Финансов» до копейки; рекомендация — кандидат сервера со ссылкой', async () => {
    await seedBoth();
    const { service, chatCompletion } = reviewer();
    chatCompletion.mockImplementationOnce(async (request: IChatCompletionRequest) => {
      const totals = factsOf(request).find((b) => b.block === 'review:totals').data;
      return {
        ...RESULT,
        content:
          `Выручка ${totals.levels.revenue.current.rub} ₽, удержано ` +
          `${totals.levels.marketplaceExpenses.current.rub} ₽. Поднимите цену B1 [R1].`,
      };
    });

    const review = await service.review(
      { telegramUserId: SELLER, aiAllowed: true, month: MONTH },
      OCT_15,
    );
    const pnl = (await finance.build(SELLER, SEPT, OCT_15, { flat: false })).pnl;
    const request = chatCompletion.mock.calls[0][0] as IChatCompletionRequest;
    const totals = factsOf(request).find((b) => b.block === 'review:totals').data;

    expect(totals.levels.revenue.current.kopecks).toBe(pnl.revenueKopecks);
    expect(totals.levels.net.current.kopecks).toBe(pnl.netKopecks);
    expect(totals.levels.marketplaceExpenses.current.kopecks).toBe(pnl.marketplaceKopecks);
    expect(review.verification).toEqual({ verified: true, unconfirmed: [] });
    expect(review.month).toBe('2026-09');
    expect(review.previousMonth).toBe('2026-08');

    expect(review.recommendations).toHaveLength(1);
    const [r1] = review.recommendations;
    expect(r1).toMatchObject({ id: 'R1', kind: 'below_min_price', sku: 'B1', name: 'Часы B1' });
    expect(r1.avgPriceKopecks).toBe(300_000);
    expect(r1.minPriceKopecks).toBeGreaterThan(r1.avgPriceKopecks);
    expect(r1.source.operationCount).toBeGreaterThan(0);
    // Комиссия выросла на 1 500 ₽ и в 4 раза — статья в фактах со своей ссылкой.
    const article = factsOf(request).find(
      (b) => b.block === 'review:article' && b.data.article === 'commission',
    ).data;
    expect(article).toMatchObject({ direction: 'расход вырос' });
    expect(article.change.kopecks).toBe(-150_000);
    expect(review.sources.some((s) => s.label.startsWith('Статья «'))).toBe(true);
    // Ozon и WB без журнала — честные пробелы.
    expect(review.gaps.some((g) => g.includes('Ozon'))).toBe(true);
    // Блок площадок — FinanceService.compare (TASK-173): правила учёта строками, ЯМ — числа.
    const compare = factsOf(request).find((b) => b.block === 'compareMarketplaces').data;
    expect(compare.rules).toContain(COMPARE_TAX_NOTE);
    const ymCompare = (await finance.compare(SELLER, SEPT, ['ym'])).reports[0].report.pnl;
    expect(compare.marketplaces[0].levels.net.kopecks).toBe(ymCompare.netKopecks);
  });

  it('чужая метка и выдуманное число — в неподтверждённых', async () => {
    await seedBoth();
    const { service, chatCompletion } = reviewer();
    chatCompletion.mockResolvedValueOnce({
      ...RESULT,
      content: 'Выручка 99 999 ₽. Закройте склад [R7].',
    });
    const review = await service.review(
      { telegramUserId: SELLER, aiAllowed: true, month: MONTH },
      OCT_15,
    );
    expect(review.verification.verified).toBe(false);
    expect(review.verification.unconfirmed).toEqual(expect.arrayContaining(['[R7]']));
    expect(review.verification.unconfirmed.some((n) => n.includes('99'))).toBe(true);
  });

  it('с turnId — счётчики разбора в AiTurn: без инструментов, один раунд (TASK-170)', async () => {
    await seedBoth();
    const { service, chatCompletion, turns } = reviewer();
    chatCompletion.mockResolvedValueOnce({
      ...RESULT,
      content: 'Выручка 99 999 ₽. Закройте склад [R7].',
    });
    await service.review(
      { telegramUserId: SELLER, aiAllowed: true, month: MONTH, turnId: 'rv-1' },
      OCT_15,
    );
    expect(turns.record).toHaveBeenCalledWith({
      turnId: 'rv-1',
      telegramUserId: SELLER,
      purpose: 'period-review',
      numbers: 1,
      // 99 999 и чужая метка [R7].
      unconfirmed: 2,
      toolCalls: 0,
      rounds: 1,
      asksBackNoTools: false,
    });
  });

  it('журнала за месяц нет — модель не зовётся, строк AiUsage нет, причина в пробелах', async () => {
    const { service, chatCompletion, usage } = reviewer();
    const review = await service.review(
      { telegramUserId: SELLER, aiAllowed: true, month: MONTH },
      OCT_15,
    );
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
    expect(review.answer).toBeNull();
    expect(review.gaps).toEqual([NO_JOURNAL_TEXT]);
  });

  it('нет прошлого месяца и убыточных товаров — прямые сообщения, без выдуманных дельт', async () => {
    await seed([row({ orderId: 2 })], SEPT);
    const { service, chatCompletion } = reviewer();
    chatCompletion.mockResolvedValueOnce({ ...RESULT, content: 'Данных для сравнения нет.' });
    const review = await service.review(
      { telegramUserId: SELLER, aiAllowed: true, month: MONTH },
      OCT_15,
    );
    expect(review.gaps).toEqual(
      expect.arrayContaining([REVIEW_NO_PREVIOUS_TEXT, REVIEW_NO_RECOMMENDATIONS_TEXT]),
    );
    expect(review.recommendations).toEqual([]);
    const facts = factsOf(chatCompletion.mock.calls[0][0]);
    expect(facts.find((b) => b.block === 'review:totals').data.levels.revenue.change).toBeNull();
    expect(facts.some((b) => b.block === 'review:article')).toBe(false);
  });

  it('закрытый «ИИ» — отказ до журнала и до Polza', async () => {
    await seedBoth();
    const { service, chatCompletion, usage } = reviewer();
    await expect(
      service.review({ telegramUserId: SELLER, aiAllowed: false, month: MONTH }, OCT_15),
    ).rejects.toBeInstanceOf(AiFeatureDisabledError);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });
});

describe('ИИ-разбор периода: чистые части', () => {
  it('метки рекомендаций: [R1], [R2, R3]; прочее в скобках — не метка', () => {
    expect(recommendationTagsOf('Цена [R1], склад [R2, R3], см. [таблица] и R4')).toEqual([
      'R1',
      'R2',
      'R3',
    ]);
  });

  it('прошлый месяц через границу года', () => {
    expect(previousScreenMonth(parseScreenMonth('2026-01')).month).toBe('2025-12');
  });

  it('выплаты по статьям — те же поручения, что выплаты; Σ = Σ строк', () => {
    const paidAt = new Date('2026-09-20T09:00:00Z');
    const paid = [
      {
        id: 'a',
        article: 'sales' as const,
        amountKopecks: 500_000,
        bankOrderId: 'P1',
        bankSumKopecks: 450_000,
        paidAt,
      },
      {
        id: 'b',
        article: 'commission' as const,
        amountKopecks: -50_000,
        bankOrderId: 'P1',
        bankSumKopecks: 450_000,
        paidAt,
      },
      {
        id: 'c',
        article: 'sales' as const,
        amountKopecks: 100_000,
        bankOrderId: 'P9',
        bankSumKopecks: 100_000,
        paidAt: new Date('2026-10-02T09:00:00Z'),
      },
    ];
    const articles = payoutArticlesOf(paid, SEPT);
    expect(articles).toEqual([
      { article: 'sales', kopecks: 500_000, operationIds: ['a'] },
      { article: 'commission', kopecks: -50_000, operationIds: ['b'] },
    ]);
  });

  it('статья меньше порога (1 000 ₽ или 10 %) не попадает в изменившиеся', () => {
    // Все статьи — нули, кроме комиссии.
    const full = (commissionKopecks: number) =>
      ({
        pnl: {
          byArticle: new Proxy(
            {},
            {
              get: (_target, key) => ({
                kopecks: key === 'commission' ? commissionKopecks : 0,
                operationIds: [],
              }),
            },
          ),
        },
      }) as never;
    expect(articleChangesOf(full(-1_050_000), full(-1_000_000))).toEqual([]);
    expect(articleChangesOf(full(-250_000), full(-100_000))).toHaveLength(1);
  });
});

const INITIAL = 'tg_rules_2026';

describe('/api/crm/ym/ai-analyst/review по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  const review = vi.fn();
  let aiTurns: ReturnType<typeof inMemoryModel>;

  async function boot(features: Record<string, boolean>) {
    review.mockReset();
    const access = inMemoryModel([
      { telegramUserId: SELLER, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER,
        campaign_id: '12345678',
        business_id: '1',
        token: 't',
        stores: [{ campaignId: '12345678', placementType: 'FBS' }],
      },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');
    aiTurns = inMemoryModel([
      { turnId: 'rv', telegramUserId: SELLER, purpose: 'period-review', rating: null },
      { turnId: 'chat', telegramUserId: SELLER, purpose: 'analyst', rating: null },
    ]);

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        AiTurnService,
        { provide: getModelToken(AiTurn.name), useValue: aiTurns },
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        {
          provide: AppConfigService,
          useValue: { isAdmin: () => false, crmInitialPassword: INITIAL },
        },
        { provide: ErrorReporter, useValue: { report: vi.fn() } },
      ],
      exports: [
        ActionLogService,
        AdminCredentialService,
        AiTurnService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        AppConfigService,
        ErrorReporter,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmAiPeriodReviewController],
      providers: [PeriodReviewTurns, { provide: PeriodReviewService, useValue: { review } }],
    })
    class ReviewModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ReviewModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    const login = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'vasya', password: INITIAL }),
    });
    const first = ((await login.json()) as { token: string }).token;
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    token = ((await change.json()) as { token: string }).token;
  }

  afterEach(async () => {
    await app?.close();
  });

  const OPEN = { [FEATURE.AI_PERIOD_REVIEW]: true, [FEATURE.AI]: true, [FEATURE.FINANCE]: true };

  const post = (body: unknown) =>
    fetch(`${base}/api/crm/ym/ai-analyst/review/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  async function poll(id: string): Promise<any> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${base}/api/crm/ym/ai-analyst/review/turns/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (body.status !== 'running') return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('разбор не завершился');
  }

  it('месяц → turnId → разбор перечислением полей; aiAllowed — из фичи', async () => {
    await boot(OPEN);
    const source = {
      source: 'finance:sku',
      label: 'R1',
      period: { from: SEPT.from, to: SEPT.to },
      operationIds: ['op1'],
      operationCount: 1,
      documentIds: [],
    };
    review.mockResolvedValue({
      month: '2026-09',
      previousMonth: '2026-08',
      answer: 'Разбор [R1]',
      verification: { verified: true, unconfirmed: [] },
      recommendations: [
        {
          id: 'R1',
          kind: 'below_min_price',
          sku: 'B1',
          name: null,
          avgPriceKopecks: 1,
          minPriceKopecks: 2,
          netKopecks: -3,
          units: 1,
          schemes: [],
          text: 't',
          source: { ...source, secret: 'нет' },
          secret: 'нет',
        },
      ],
      sources: [source],
      gaps: [],
      prompt: 'не наружу',
    });
    const month = financeToday().slice(0, 7);
    const started = await post({ month });
    expect(started.status).toBe(201);
    const body = await poll(((await started.json()) as { turnId: string }).turnId);
    expect(body.status).toBe('done');
    expect(body.answer.prompt).toBeUndefined();
    expect(body.answer.recommendations[0].secret).toBeUndefined();
    expect(body.answer.recommendations[0].source).toEqual(source);
    expect(review.mock.calls[0][0]).toMatchObject({ telegramUserId: SELLER, aiAllowed: true });
    // Фичи площадок — для блока сравнения; закрытые (здесь — все) не уходят.
    expect(review.mock.calls[0][0].features).toEqual([]);
    expect(review.mock.calls[0][0].month.month).toBe(month);
  });

  it('👍/👎 разбора: свой ход — 200 и замена; ход чата по адресу разбора — 404 (TASK-170)', async () => {
    await boot(OPEN);
    const rate = (id: string, rating: string) =>
      fetch(`${base}/api/crm/ym/ai-analyst/review/turns/${id}/rating`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating }),
      });
    expect((await rate('rv', 'down')).status).toBe(200);
    expect((await rate('rv', 'up')).status).toBe(200);
    expect(aiTurns.documents.find((d) => d.turnId === 'rv').rating).toBe('up');
    expect((await rate('chat', 'up')).status).toBe(404);
    expect((await rate('rv', 'meh')).status).toBe(400);
  });

  it('кривой или слишком старый месяц — 400 INVALID_MONTH, разбор не запущен', async () => {
    await boot(OPEN);
    for (const month of ['сентябрь', '2020-01', undefined]) {
      const res = await post({ month });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe(INVALID_MONTH);
    }
    expect(review).not.toHaveBeenCalled();
  });

  it('закрытая фича разбора или закрытый «ИИ» — 403 FEATURE_DISABLED до сервиса', async () => {
    for (const features of [
      { ...OPEN, [FEATURE.AI_PERIOD_REVIEW]: false },
      { ...OPEN, [FEATURE.AI]: false },
    ]) {
      await boot(features);
      const res = await post({ month: financeToday().slice(0, 7) });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
      expect(review).not.toHaveBeenCalled();
      await app.close();
      app = undefined;
    }
  });
});
