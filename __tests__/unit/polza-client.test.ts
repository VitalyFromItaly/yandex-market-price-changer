import { Global, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AiUsageService } from '../../src/database/services/ai-usage.service';
import { AiModule } from '../../src/modules/ai/ai.module';
import { AiService } from '../../src/modules/ai/ai.service';
import {
  POLZA_PATHS,
  POLZA_TIMEOUT_MS,
  PolzaClient,
  mapBalance,
  mapModels,
  mapChatCompletion,
} from '../../src/modules/ai/polza.client';
import {
  PolzaDisabledError,
  PolzaInsufficientFundsError,
  PolzaNetworkError,
  PolzaRateLimitError,
} from '../../src/modules/ai/polza.errors';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';

const BASE_URL = 'https://polza.ai/api';
const TOKEN = 'pza_SECRET_test_token_0123456789';

/** Пример ответа chat/completions из документации Polza. */
const DOC_COMPLETION = {
  id: 'gen_581761234567890123',
  object: 'chat.completion',
  created: 1735000000,
  model: 'openai/gpt-4o',
  provider: 'OpenAI',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'Привет!' }, finish_reason: 'stop' },
  ],
  usage: {
    prompt_tokens: 25,
    completion_tokens: 150,
    total_tokens: 175,
    cost_rub: 0.04131306,
    cost: 0.04131306,
    prompt_tokens_details: { cached_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 7 },
  },
};

/** Пример ответа GET /v2/balance: деньги — строки с восемью знаками. */
const DOC_BALANCE = {
  amount: '1250.50000000',
  available: '1200.25000000',
  reservedAmount: '50.25000000',
  spentAmount: '349.50000000',
  updatedAt: '2026-10-14T09:00:00.000Z',
};

/** Перехватывает axios.create (образец — yandex-client.test.ts) и отвечает очередью. */
function stubAxios() {
  const created: Array<Record<string, any>> = [];
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  /** Конфиг запроса (второй аргумент get) — отдельно, чтобы не ломать сверку calls. */
  const getConfigs: unknown[] = [];
  let queue: Array<() => unknown> = [];
  let onError: (error: unknown) => unknown = (e) => {
    throw e;
  };

  const record = async (call: (typeof calls)[number]) => {
    calls.push(call);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    try {
      return { data: await next?.() };
    } catch (raw) {
      return onError(raw);
    }
  };

  vi.spyOn(axios, 'create').mockImplementation((config: any) => {
    created.push(config);
    return {
      interceptors: {
        response: { use: (_ok: unknown, err: (e: unknown) => unknown) => (onError = err) },
      },
      get: (path: string, config?: unknown) => {
        getConfigs.push(config);
        return record({ method: 'get', path });
      },
      post: (path: string, body: unknown) => record({ method: 'post', path, body }),
    } as never;
  });

  const failure =
    (status: number | undefined, data?: unknown, headers: Record<string, string> = {}) =>
    () => {
      const error: any = new Error(
        status ? `Request failed with status code ${status}` : 'timeout of 620000ms exceeded',
      );
      // config с заголовками — как у настоящего axios: в нём лежит Bearer.
      error.config = {
        method: 'post',
        url: POLZA_PATHS.chatCompletions,
        headers: { Authorization: `Bearer ${TOKEN}` },
      };
      if (status) error.response = { status, data, headers };
      throw error;
    };

  return {
    created,
    calls,
    getConfigs,
    respond(...steps: Array<() => unknown>) {
      queue = steps;
    },
    ok: (data: unknown) => () => data,
    failure,
  };
}

const client = (
  token: string | undefined = TOKEN,
  sleep = vi.fn().mockResolvedValue(undefined),
) => ({
  sleep,
  client: new PolzaClient(
    { baseUrl: BASE_URL, token, model: 'google/gemini-2.5-flash-lite' },
    { sleep },
  ),
});

describe('PolzaClient', () => {
  let stub: ReturnType<typeof stubAxios>;
  let logged: string[];

  beforeEach(() => {
    stub = stubAxios();
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('axios: база, таймаут 620 с, Bearer', () => {
    client();
    expect(stub.created[0].baseURL).toBe(BASE_URL);
    expect(stub.created[0].timeout).toBe(POLZA_TIMEOUT_MS);
    expect(stub.created[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('chatCompletion: тело запроса и разбор ответа по документации', async () => {
    stub.respond(stub.ok(DOC_COMPLETION));
    const result = await client().client.chatCompletion({
      messages: [{ role: 'user', content: 'Привет' }],
      responseFormat: { type: 'json_object' },
      maxTokens: 100,
      temperature: 0.2,
    });

    expect(stub.calls[0]).toEqual({
      method: 'post',
      path: '/v1/chat/completions',
      body: {
        model: 'google/gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: 'Привет' }],
        response_format: { type: 'json_object' },
        max_tokens: 100,
        temperature: 0.2,
      },
    });
    expect(result).toEqual({
      content: 'Привет!',
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        promptTokens: 25,
        completionTokens: 150,
        totalTokens: 175,
        cachedTokens: 3,
        reasoningTokens: 7,
        costRub: 0.04131306,
      },
      model: 'openai/gpt-4o',
      provider: 'OpenAI',
      traceId: 'gen_581761234567890123',
    });
  });

  it('tools: описания, tool_choice и диалог с вызовом уходят в snake_case (TASK-147)', async () => {
    stub.respond(stub.ok(DOC_COMPLETION));
    const tool = {
      type: 'function' as const,
      function: { name: 'getPnl', description: 'P&L', parameters: { type: 'object' } },
    };
    await client().client.chatCompletion({
      messages: [
        { role: 'user', content: 'Сколько заработал?' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call_1', name: 'getPnl', arguments: '{"from":"2026-09-01"}' }],
        },
        { role: 'tool', toolCallId: 'call_1', content: '{"ok":true}' },
        { role: 'assistant', content: 'Готово' },
      ],
      tools: [tool],
      toolChoice: 'auto',
    });
    expect(stub.calls[0].body).toEqual({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'user', content: 'Сколько заработал?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'getPnl', arguments: '{"from":"2026-09-01"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
        { role: 'assistant', content: 'Готово' },
      ],
      tools: [tool],
      tool_choice: 'auto',
    });
  });

  it('ответ с tool_calls: content null → пусто, аргументы строкой, вызов без имени отброшен', () => {
    const result = mapChatCompletion({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'getPnl', arguments: '{"from":"2026-09-01","to":"2026-09-30"}' },
              },
              // Бывает у провайдеров: аргументы объектом, а не строкой.
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'listAnomalies', arguments: { month: '2026-09' } },
              },
              { id: 'call_3', type: 'function', function: { arguments: '{}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'getPnl', arguments: '{"from":"2026-09-01","to":"2026-09-30"}' },
      { id: 'call_2', name: 'listAnomalies', arguments: '{"month":"2026-09"}' },
    ]);
  });

  it('модель из запроса важнее умолчания; лишних полей нет', async () => {
    stub.respond(stub.ok(DOC_COMPLETION));
    await client().client.chatCompletion({ model: 'x/y', messages: [] });
    expect(stub.calls[0].body).toEqual({ model: 'x/y', messages: [] });
  });

  it('getBalance: строки → числа', async () => {
    stub.respond(stub.ok(DOC_BALANCE));
    const balance = await client().client.getBalance();
    expect(stub.calls[0]).toEqual({ method: 'get', path: '/v2/balance' });
    expect(balance).toEqual({
      amount: 1250.5,
      available: 1200.25,
      reservedAmount: 50.25,
      spentAmount: 349.5,
      updatedAt: '2026-10-14T09:00:00.000Z',
    });
  });

  it('getBalance({retry: false}) — 503 без повторов, signal уходит в axios', async () => {
    stub.respond(stub.failure(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } }));
    const { client: c, sleep } = client();
    const controller = new AbortController();
    await expect(c.getBalance({ signal: controller.signal, retry: false })).rejects.toMatchObject({
      status: 503,
    });
    expect(stub.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(stub.getConfigs[0]).toEqual({ signal: controller.signal });
  });

  it('getBalance() по умолчанию повторяет 503, как остальные методы', async () => {
    stub.respond(stub.failure(503, {}), stub.ok(DOC_BALANCE));
    const { client: c } = client();
    await expect(c.getBalance()).resolves.toMatchObject({ available: 1200.25 });
    expect(stub.calls).toHaveLength(2);
  });

  it('без proxyUrl агента нет; с ним — HttpsProxyAgent и proxy: false', () => {
    client();
    expect(stub.created[0].httpsAgent).toBeUndefined();
    new PolzaClient({ baseUrl: BASE_URL, token: TOKEN, proxyUrl: 'http://194.0.0.1:8888' });
    expect(stub.created[1].httpsAgent).toBeInstanceOf(HttpsProxyAgent);
    expect(String(stub.created[1].httpsAgent.proxy)).toBe('http://194.0.0.1:8888/');
    expect(stub.created[1].proxy).toBe(false);
  });

  it('getBalance без reserved/spent (персональный лимит) — null, а не 0', () => {
    expect(mapBalance({ amount: '1.00000000', available: '1.00000000' })).toMatchObject({
      reservedAmount: null,
      spentAmount: null,
    });
  });

  it('listModels: {data: [...]} и голый массив', async () => {
    stub.respond(stub.ok({ data: [{ id: 'a/b', name: 'B' }, { id: '' }] }));
    expect(await client().client.listModels()).toEqual([
      {
        id: 'a/b',
        name: 'B',
        contextLength: null,
        pricing: null,
        structuredOutputs: false,
        tools: false,
      },
    ]);
    expect(stub.calls[0].path).toBe('/v1/models');
    expect(mapModels([{ id: 'x/y' }]).map((m) => m.id)).toEqual(['x/y']);
  });

  it('listModels: цена ₽ за 1M и structured_outputs из top_provider (живая форма 14-10-2026)', () => {
    const [model] = mapModels({
      object: 'list',
      data: [
        {
          id: 'google/gemini-2.5-flash-lite',
          name: 'Google: Gemini 2.5 Flash Lite',
          type: 'chat',
          context_length: 1048576,
          top_provider: {
            name: 'google-ai-studio/flex',
            supported_parameters: ['structured_outputs', 'response_format', 'max_tokens', 'tools'],
            pricing: {
              prompt_per_million: '5.94980000',
              completion_per_million: '23.79920000',
              currency: 'RUB',
            },
          },
        },
      ],
    });
    expect(model).toEqual({
      id: 'google/gemini-2.5-flash-lite',
      name: 'Google: Gemini 2.5 Flash Lite',
      type: 'chat',
      contextLength: 1048576,
      pricing: { promptPerMillionRub: 5.9498, completionPerMillionRub: 23.7992 },
      structuredOutputs: true,
      tools: true,
    });
  });

  it('listModels: цены нет — null, а не 0 (tts/image, чужая валюта, мусор)', () => {
    const models = mapModels([
      { id: 'tts', type: 'tts', top_provider: { pricing: { currency: 'RUB' } } },
      {
        id: 'img',
        type: 'image',
        top_provider: { pricing: { tiers: [{ cost_rub: '3' }], currency: 'RUB' } },
      },
      {
        id: 'usd',
        top_provider: {
          pricing: { prompt_per_million: '1', completion_per_million: '2', currency: 'USD' },
        },
      },
      {
        id: 'junk',
        top_provider: {
          pricing: { prompt_per_million: 'abc', completion_per_million: '2', currency: 'RUB' },
        },
      },
    ]);
    expect(models.map((m) => m.pricing)).toEqual([null, null, null, null]);
  });

  it('пустой ответ — нули, не NaN', () => {
    expect(mapChatCompletion({}).usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      costRub: 0,
    });
  });

  describe('повторы', () => {
    it('402 — один вызов, без пауз', async () => {
      stub.respond(
        stub.failure(402, { error: { code: 'INSUFFICIENT_BALANCE', message: 'Нет денег' } }),
      );
      const { client: c, sleep } = client();
      await expect(c.chatCompletion({ messages: [] })).rejects.toBeInstanceOf(
        PolzaInsufficientFundsError,
      );
      expect(stub.calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('429 с Retry-After — ждёт ровно его', async () => {
      stub.respond(stub.failure(429, {}, { 'retry-after': '3' }), stub.ok(DOC_COMPLETION));
      const { client: c, sleep } = client();
      await expect(c.chatCompletion({ messages: [] })).resolves.toMatchObject({
        content: 'Привет!',
      });
      expect(stub.calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledWith(3000);
    });

    it('429 без заголовка — 1/2/4 с, затем сдаётся', async () => {
      stub.respond(stub.failure(429, {}));
      const { client: c, sleep } = client();
      await expect(c.chatCompletion({ messages: [] })).rejects.toBeInstanceOf(PolzaRateLimitError);
      expect(stub.calls).toHaveLength(4);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    });

    it('502 — повторяет', async () => {
      stub.respond(stub.failure(502), stub.ok(DOC_COMPLETION));
      await expect(client().client.chatCompletion({ messages: [] })).resolves.toBeTruthy();
      expect(stub.calls).toHaveLength(2);
    });

    it('сетевой сбой/таймаут — не повторяет: запрос мог быть оплачен', async () => {
      stub.respond(stub.failure(undefined));
      await expect(client().client.chatCompletion({ messages: [] })).rejects.toBeInstanceOf(
        PolzaNetworkError,
      );
      expect(stub.calls).toHaveLength(1);
    });
  });

  it('без токена — PolzaDisabledError и ни одного HTTP', async () => {
    const { client: c } = client('');
    await expect(c.chatCompletion({ messages: [] })).rejects.toBeInstanceOf(PolzaDisabledError);
    await expect(c.getBalance()).rejects.toBeInstanceOf(PolzaDisabledError);
    await expect(c.listModels()).rejects.toBeInstanceOf(PolzaDisabledError);
    expect(stub.calls).toHaveLength(0);
    expect(stub.created[0].headers.Authorization).toBeUndefined();
  });

  it('ключ не попадает ни в логи, ни в ошибку, ни в журнал ErrorReporter', async () => {
    stub.respond(
      stub.failure(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } }),
      stub.failure(402, {
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Нет денег' },
        trace_id: 'tr',
      }),
    );
    let caught: unknown;
    try {
      await client().client.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) {
      caught = e;
    }
    const error = caught as Error;
    expect(error).toBeInstanceOf(PolzaInsufficientFundsError);

    const record = vi.fn().mockResolvedValue(undefined);
    const reporter = new ErrorReporter({ record } as unknown as ActionLogService);
    reporter.setAlertSender(vi.fn().mockResolvedValue(undefined));
    await reporter.report({ error, source: 'queue', context: 'ai:test' });

    const everything = [
      ...logged,
      error.message,
      error.stack ?? '',
      JSON.stringify(error),
      JSON.stringify(record.mock.calls),
    ].join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(record.mock.calls[0][0].source).toBe('polza');
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('Bearer');
  });
});

describe('AiModule', () => {
  function configStub(token?: string): Partial<AppConfigService> {
    return {
      polzaAiToken: token,
      polzaAiBaseUrl: BASE_URL,
      polzaAiModel: undefined,
      polzaAiEnabled: Boolean(token),
    };
  }

  /** Настоящий DatabaseModule полез бы в Mongo; AiModule берёт из него только AiUsageService. */
  @Module({
    providers: [{ provide: AiUsageService, useValue: { record: vi.fn(), spentRubSince: vi.fn() } }],
    exports: [AiUsageService],
  })
  class FakeDatabaseModule {}

  function stubsModule(token?: string) {
    @Global()
    @Module({
      providers: [
        { provide: AppConfigService, useValue: configStub(token) },
        { provide: ErrorReporter, useValue: { report: vi.fn() } },
      ],
      exports: [AppConfigService, ErrorReporter],
    })
    class StubsModule {}
    return StubsModule;
  }

  async function compile(token?: string) {
    return Test.createTestingModule({ imports: [stubsModule(token), AiModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
  }

  it('без токена поднимается, вызов бросает PolzaDisabledError', async () => {
    const moduleRef = await compile(undefined);
    const polza = moduleRef.get(PolzaClient, { strict: false });
    await expect(polza.getBalance()).rejects.toBeInstanceOf(PolzaDisabledError);
  });

  it('наружу — только AiService', () => {
    expect(Reflect.getMetadata('exports', AiModule)).toEqual([AiService]);
  });

  it('PolzaClient наружу не экспортируется', async () => {
    expect(Reflect.getMetadata('exports', AiModule) ?? []).not.toContain(PolzaClient);
    // Сосед, импортирующий AiModule, получить клиент через DI не может.
    @Module({
      imports: [AiModule],
      providers: [
        { provide: 'CONSUMER', inject: [PolzaClient], useFactory: (c: PolzaClient) => c },
      ],
    })
    class ConsumerModule {}

    await expect(
      Test.createTestingModule({ imports: [stubsModule(TOKEN), ConsumerModule] })
        .overrideModule(DatabaseModule)
        .useModule(FakeDatabaseModule)
        .compile(),
    ).rejects.toThrow(/PolzaClient/);
  });
});
