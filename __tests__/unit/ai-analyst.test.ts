import type {
  IChatCompletionRequest,
  IChatCompletionResult,
} from '../../src/modules/ai/polza.client';
import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AiTurn } from '../../src/database/schemas/ai-turn.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { MarketplaceConnection } from '../../src/database/schemas/marketplace-connection.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AiTurnService } from '../../src/database/services/ai-turn.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { MarketplaceConnectionService } from '../../src/database/services/marketplace-connection.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AI_EVAL_PURPOSE } from '../../src/database/services/ai-usage.service';
import { AiDailyLimitError } from '../../src/modules/ai/ai.errors';
import { AiService } from '../../src/modules/ai/ai.service';
import {
  AiAnalystService,
  AnalystHistoryError,
} from '../../src/modules/ai-analyst/ai-analyst.service';
import { AI_TOOL } from '../../src/modules/ai-tools/ai-tools.domain';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import { CrmAiAnalystController } from '../../src/modules/crm/ai-analyst/crm-ai-analyst.controller';
import { AiAnalystTurns } from '../../src/modules/crm/ai-analyst/crm-ai-analyst.turns';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';
import {
  ANALYST_NOW,
  ANALYST_SELLER,
  ANALYST_SEPT,
  seedAnalystTools,
} from '../helpers/analyst-fixture';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «ИИ-аналитик» (TASK-148): настоящий AiService (Polza — заглушка), настоящие
 * инструменты на PGlite и настоящий HTTP. Проверяется главное: числа ответа
 * сверяются с тем, что инструменты отдали ЭТОМУ ответу, ссылки ведут на
 * операции журнала, отказы — текстом без алерта, гейт закрывает до AiService.
 */

const SELLER = ANALYST_SELLER;
const SEPT = ANALYST_SEPT;
const OCT_15 = ANALYST_NOW;
const QUESTION = [{ role: 'user', content: 'Где я заработал больше в сентябре?' }];

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

const asks = (name: string, args: unknown): IChatCompletionResult => ({
  ...RESULT,
  finishReason: 'tool_calls',
  toolCalls: [{ id: 'call_1', name, arguments: JSON.stringify(args) }],
});
const says = (content: string): IChatCompletionResult => ({ ...RESULT, content });

/** Что инструмент вернул модели — последнее tool-сообщение запроса. */
function lastToolResult(request: IChatCompletionRequest): any {
  const tool = [...request.messages].reverse().find((m) => m.role === 'tool');
  return tool && 'content' in tool ? JSON.parse(tool.content) : null;
}

let test: ITestFinanceDb;
let tools: AiToolsService;

// Засев общий со `scripts/eval-ai-analyst.ts --seed` (TASK-169).
beforeAll(async () => {
  test = await createTestFinanceDb();
  tools = await seedAnalystTools(test.db);
});

afterAll(async () => {
  await test?.close();
});

function analyst() {
  const chatCompletion = vi.fn();
  const usage = { record: vi.fn(), spentRubSince: vi.fn().mockResolvedValue(0) };
  const errors = { report: vi.fn() };
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
    errors as never,
  );
  const turns = { record: vi.fn() };
  return {
    service: new AiAnalystService(ai, tools, turns as never),
    chatCompletion,
    usage,
    errors,
    turns,
  };
}

describe('AiAnalystService — ход чата на живом журнале', { timeout: 60_000 }, () => {
  it('число из данных подтверждено, ссылки ведут на операции журнала', async () => {
    const { service, chatCompletion } = analyst();
    chatCompletion
      .mockResolvedValueOnce(asks(AI_TOOL.PNL, { from: SEPT.from, to: SEPT.to }))
      .mockImplementationOnce(async (request: IChatCompletionRequest) => {
        const { levels } = lastToolResult(request).data;
        return says(`В сентябре выручка ${levels.revenue.rub} ₽, заказов ${levels.ordersCount}.`);
      });

    const answer = await service.ask(
      { telegramUserId: SELLER, aiAllowed: true, messages: QUESTION },
      OCT_15,
    );

    expect(answer.answer).toBe('В сентябре выручка 12000.00 ₽, заказов 2.');
    expect(answer.verification).toEqual({ verified: true, unconfirmed: [] });
    expect(answer.rounds).toBe(2);
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0]).toMatchObject({
      source: 'finance:pnl',
      period: { from: SEPT.from, to: SEPT.to },
      operationCount: 2,
    });
    expect(answer.sources[0].operationIds).toHaveLength(2);
    // Системный промпт — первым, история браузера — за ним.
    const first = chatCompletion.mock.calls[0][0] as IChatCompletionRequest;
    expect(first.messages[0].role).toBe('system');
    expect(first.messages[1]).toEqual(QUESTION[0]);
  });

  it('purpose и вызовы инструментов — для контрольного набора (TASK-169)', async () => {
    const { service, chatCompletion, usage } = analyst();
    const args = { from: SEPT.from, to: SEPT.to };
    chatCompletion
      .mockResolvedValueOnce(asks(AI_TOOL.PNL, args))
      .mockResolvedValueOnce(says('Готово.'));

    const answer = await service.ask(
      { telegramUserId: SELLER, aiAllowed: true, messages: QUESTION, purpose: AI_EVAL_PURPOSE },
      OCT_15,
    );

    expect(usage.record).toHaveBeenCalledTimes(2);
    for (const [row] of usage.record.mock.calls) expect(row.purpose).toBe('eval');
    expect(answer.toolResults).toHaveLength(1);
    expect(answer.toolResults[0]).toMatchObject({ name: AI_TOOL.PNL, result: { ok: true } });
    expect(JSON.parse(answer.toolResults[0].arguments)).toEqual(args);
    expect(answer.costRub).toBeCloseTo(0.02, 10);

    // Без purpose — как раньше, `analyst`.
    chatCompletion.mockResolvedValueOnce(says('Ок.'));
    await service.ask({ telegramUserId: SELLER, aiAllowed: true, messages: QUESTION }, OCT_15);
    expect(usage.record.mock.calls[2][0].purpose).toBe('analyst');
  });

  it('с turnId — счётчики хода в AiTurn без текста; без turnId строки нет (TASK-170)', async () => {
    const { service, chatCompletion, turns } = analyst();
    chatCompletion
      .mockResolvedValueOnce(asks(AI_TOOL.PNL, { from: SEPT.from, to: SEPT.to }))
      .mockResolvedValueOnce(
        says('В сентябре выручка 12000.00 ₽, а прибыль 99 999 ₽ за 3 месяца.'),
      );

    await service.ask(
      { telegramUserId: SELLER, aiAllowed: true, messages: QUESTION, turnId: 'turn-1' },
      OCT_15,
    );

    expect(turns.record).toHaveBeenCalledTimes(1);
    const [row] = turns.record.mock.calls[0];
    // «3 месяца» — мелкий счёт, не проверяется и не считается.
    expect(row).toEqual({
      turnId: 'turn-1',
      telegramUserId: SELLER,
      purpose: 'analyst',
      numbers: 2,
      unconfirmed: 1,
      toolCalls: 1,
      rounds: 2,
      asksBackNoTools: false,
    });

    chatCompletion.mockResolvedValueOnce(says('Ок.'));
    await service.ask({ telegramUserId: SELLER, aiAllowed: true, messages: QUESTION }, OCT_15);
    expect(turns.record).toHaveBeenCalledTimes(1);
  });

  it('число, которого в данных нет, помечается', async () => {
    const { service, chatCompletion } = analyst();
    chatCompletion
      .mockResolvedValueOnce(asks(AI_TOOL.PNL, { from: SEPT.from, to: SEPT.to }))
      .mockResolvedValueOnce(says('Выручка 12 000 ₽, а в среднем на заказ — 6 500 ₽.'));
    const answer = await service.ask(
      { telegramUserId: SELLER, aiAllowed: true, messages: QUESTION },
      OCT_15,
    );
    expect(answer.verification).toEqual({ verified: false, unconfirmed: ['6 500'] });
  });

  it('WB: «данных недостаточно» приходит пробелом, а не нулём', async () => {
    const { service, chatCompletion } = analyst();
    chatCompletion
      .mockResolvedValueOnce(asks(AI_TOOL.COMPARE, { from: SEPT.from, to: SEPT.to }))
      .mockResolvedValueOnce(says('По Wildberries данных недостаточно — журнала нет.'));
    const answer = await service.ask(
      {
        telegramUserId: SELLER,
        aiAllowed: true,
        messages: [{ role: 'user', content: 'Почему рентабельность WB ниже?' }],
      },
      OCT_15,
    );
    expect(answer.gaps.some((gap) => gap.includes('Wildberries'))).toBe(true);
    expect(answer.verification.verified).toBe(true);
  });

  it('кривая история — отказ до Polza; закрытый ai — AiService отказывает до HTTP', async () => {
    const { service, chatCompletion, usage } = analyst();
    await expect(
      service.ask({ telegramUserId: SELLER, aiAllowed: true, messages: [{ role: 'system' }] }),
    ).rejects.toBeInstanceOf(AnalystHistoryError);
    await expect(
      service.ask({ telegramUserId: SELLER, aiAllowed: false, messages: QUESTION }),
    ).rejects.toMatchObject({ name: 'AiFeatureDisabledError' });
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });
});

describe('AiAnalystTurns — ход в памяти', () => {
  const answer = {
    answer: 'ok',
    verification: { verified: true, unconfirmed: [] },
    sources: [],
    gaps: [],
    rounds: 1,
  };

  async function settle() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('один ход на продавца; чужой ход не виден; готовый живёт 10 минут', async () => {
    let release: (value: unknown) => void = () => undefined;
    const ask = vi.fn(() => new Promise((resolve) => (release = resolve)));
    const turns = new AiAnalystTurns({ ask } as never, { report: vi.fn() } as never);
    let now = 1_000;
    const clock = () => now;

    const id = turns.start({ telegramUserId: SELLER, aiAllowed: true, messages: QUESTION }, clock);
    expect(() =>
      turns.start({ telegramUserId: SELLER, aiAllowed: true, messages: QUESTION }, clock),
    ).toThrow(expect.objectContaining({ turnId: id }));
    expect(turns.view('999', id, clock)).toBeNull();
    expect(turns.view(SELLER, id, clock)).toMatchObject({ status: 'running' });

    release(answer);
    await settle();
    expect(turns.view(SELLER, id, clock)).toMatchObject({ status: 'done', answer });

    now += 11 * 60_000;
    expect(turns.view(SELLER, id, clock)).toBeNull();
  });

  it('лимит — текст продавцу без репорта; наша поломка — репорт и общий текст', async () => {
    const errors = { report: vi.fn() };
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new AiDailyLimitError(51, 50))
      .mockRejectedValueOnce(new Error('boom'));
    const turns = new AiAnalystTurns({ ask } as never, errors as never);

    const limited = turns.start({ telegramUserId: SELLER, aiAllowed: true, messages: QUESTION });
    await settle();
    expect(turns.view(SELLER, limited)).toEqual({
      status: 'failed',
      message: 'Дневной лимит ИИ-запросов исчерпан. Попробуйте завтра.',
      answer: undefined,
    });
    expect(errors.report).not.toHaveBeenCalled();

    const broken = turns.start({ telegramUserId: SELLER, aiAllowed: true, messages: QUESTION });
    await settle();
    expect(turns.view(SELLER, broken)?.status).toBe('failed');
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'crm:ai-analyst', telegramUserId: SELLER }),
    );
  });
});

const INITIAL = 'tg_rules_2026';

describe('/api/crm/ym/ai-analyst по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let access: ReturnType<typeof inMemoryModel>;
  let base: string;
  let token: string;
  const ask = vi.fn();
  let aiTurns: ReturnType<typeof inMemoryModel>;

  // Таймаут describe касается тестов, а не хуков: хуку vitest даёт свои 10 с. Этому хватает в покое,
  // но не под полным прогоном — сборка Nest с CrmModule, listen и три bcrypt cost 12 (ensure, логин,
  // смена пароля) там тянутся за 10 с. Поэтому явный таймаут. В beforeAll не переносится: тесты
  // делят ходы AiAnalystTurns (вечно идущий ход второго теста дал бы 409 следующим) и features.
  const HOOK_TIMEOUT_MS = 60_000;

  beforeEach(async () => {
    ask.mockReset();
    access = inMemoryModel([
      {
        telegramUserId: SELLER,
        botId: '999',
        status: 'approved',
        username: 'Vasya',
        features: { [FEATURE.AI_ANALYST]: true, [FEATURE.AI]: true, [FEATURE.FINANCE]: true },
      },
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
    aiTurns = inMemoryModel([
      { turnId: 'own', telegramUserId: SELLER, purpose: 'analyst', rating: null },
      { turnId: 'foreign', telegramUserId: '424242', purpose: 'analyst', rating: null },
      { turnId: 'own-review', telegramUserId: SELLER, purpose: 'period-review', rating: null },
    ]);
    const admin = inMemoryModel();
    admin.uniqueBy('key');

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        AiTurnService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        { provide: getModelToken(MarketplaceConnection.name), useValue: inMemoryModel() },
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AiTurn.name), useValue: aiTurns },
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
        MarketplaceConnectionService,
        AppConfigService,
        ErrorReporter,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmAiAnalystController],
      providers: [AiAnalystTurns, { provide: AiAnalystService, useValue: { ask } }],
    })
    class AnalystModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AnalystModule] })
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
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await app.close();
  }, HOOK_TIMEOUT_MS);

  const post = (body: unknown) =>
    fetch(`${base}/api/crm/ym/ai-analyst/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const get = (id: string) =>
    fetch(`${base}/api/crm/ym/ai-analyst/turns/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });

  async function poll(id: string): Promise<any> {
    for (let i = 0; i < 50; i++) {
      const body = await (await get(id)).json();
      if (body.status !== 'running') return body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('ход не завершился');
  }

  it('вопрос → turnId → ответ перечислением полей; aiAllowed — из фичи', async () => {
    ask.mockResolvedValue({
      answer: 'Выручка 12000.00 ₽',
      verification: { verified: true, unconfirmed: [], extra: 'x' },
      sources: [
        {
          source: 'finance:pnl',
          label: 'P&L из журнала',
          period: { from: SEPT.from, to: SEPT.to },
          operationIds: ['op1'],
          operationCount: 1,
          documentIds: [],
          secret: 'нет',
        },
      ],
      gaps: [],
      rounds: 2,
      prompt: 'не наружу',
    });
    const started = await post({ messages: QUESTION });
    expect(started.status).toBe(201);
    const { turnId } = (await started.json()) as { turnId: string };
    const body = await poll(turnId);
    expect(body).toEqual({
      status: 'done',
      answer: {
        answer: 'Выручка 12000.00 ₽',
        verification: { verified: true, unconfirmed: [] },
        sources: [
          {
            source: 'finance:pnl',
            label: 'P&L из журнала',
            period: { from: SEPT.from, to: SEPT.to },
            operationIds: ['op1'],
            operationCount: 1,
            documentIds: [],
          },
        ],
        gaps: [],
        rounds: 2,
      },
    });
    expect(ask).toHaveBeenCalledWith({
      telegramUserId: SELLER,
      aiAllowed: true,
      // Открыты «Финансы» и «Едет обратно» (она по умолчанию включена) — из инструментов
      // экранов модель увидит getCashflow и getReturns.
      features: [FEATURE.FINANCE, FEATURE.REPORT_RETURNING],
      messages: QUESTION,
      // id хода — тот же, что получил фронт: по нему пишутся счётчики и ставится оценка.
      turnId,
    });
  });

  it('кривая история — 400; второй ход — 409 с id идущего; чужой id — 404', async () => {
    const bad = await post({ messages: [{ role: 'system', content: 'x' }] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('INVALID_MESSAGES');

    ask.mockReturnValue(new Promise(() => undefined));
    const { turnId } = (await (await post({ messages: QUESTION })).json()) as { turnId: string };
    const second = await post({ messages: QUESTION });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'TURN_RUNNING', turnId });

    expect((await get('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('👍/👎: свой ход, повтор заменяет; чужой и ход разбора — 404; мусор — 400 (TASK-170)', async () => {
    const rate = (id: string, body: unknown) =>
      fetch(`${base}/api/crm/ym/ai-analyst/turns/${id}/rating`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    const up = await rate('own', { rating: 'up' });
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ rating: 'up' });
    expect((await rate('own', { rating: 'down' })).status).toBe(200);
    const own = aiTurns.documents.filter((d) => d.turnId === 'own');
    expect(own).toHaveLength(1);
    expect(own[0].rating).toBe('down');

    const foreign = await rate('foreign', { rating: 'down' });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { code: string }).code).toBe('TURN_NOT_FOUND');
    expect(aiTurns.documents.find((d) => d.turnId === 'foreign').rating).toBeNull();
    expect((await rate('own-review', { rating: 'up' })).status).toBe(404);
    expect((await rate('missing', { rating: 'up' })).status).toBe(404);

    const bad = await rate('own', { rating: 'meh', text: 'отзыв' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('INVALID_RATING');
    // Хранится только оценка: ни текста, ни лишних полей из тела.
    expect(Object.keys(own[0]).sort()).toEqual(
      ['purpose', 'ratedAt', 'rating', 'telegramUserId', 'turnId'].sort(),
    );
  });

  it('закрыт «ИИ» — 403 FEATURE_DISABLED, до AiService дело не доходит', async () => {
    access.documents[0].features = { [FEATURE.AI_ANALYST]: true, [FEATURE.FINANCE]: true };
    const refused = await post({ messages: QUESTION });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    expect(ask).not.toHaveBeenCalled();
  });

  it('закрыта сама фича — 403', async () => {
    access.documents[0].features = { [FEATURE.AI]: true, [FEATURE.FINANCE]: true };
    expect((await post({ messages: QUESTION })).status).toBe(403);
    expect(ask).not.toHaveBeenCalled();
  });
});
