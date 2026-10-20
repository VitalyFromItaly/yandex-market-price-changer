import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AiUsageService } from '../../src/database/services/ai-usage.service';
import {
  AiDailyLimitError,
  AiFeatureDisabledError,
  AiUnavailableError,
} from '../../src/modules/ai/ai.errors';
import {
  AI_TOOL_ROUND_TIMEOUT_MS,
  AiService,
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
  TOOL_TIMEOUT_TEXT,
} from '../../src/modules/ai/ai.service';
import { PolzaClient } from '../../src/modules/ai/polza.client';
import {
  PolzaApiError,
  PolzaInsufficientFundsError,
  PolzaModerationError,
  PolzaNetworkError,
} from '../../src/modules/ai/polza.errors';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { moscowDayStart } from '../../src/modules/yandex/reports/moscow-day';

const RESULT = {
  content: 'секретный ответ модели',
  usage: {
    promptTokens: 12,
    completionTokens: 34,
    totalTokens: 46,
    cachedTokens: 2,
    reasoningTokens: 5,
    costRub: 0.00018,
  },
  model: 'google/gemini-2.5-flash-lite',
  provider: '',
  traceId: 'gen_581761234567890123',
};

const REQUEST = { messages: [{ role: 'user' as const, content: 'секретный промпт продавца' }] };
const CTX = { telegramUserId: '42', aiAllowed: true, purpose: 'check' };
// 14-10-2026 12:00 МСК
const NOW = new Date('2026-10-14T09:00:00Z');

describe('AiService', () => {
  let chatCompletion: ReturnType<typeof vi.fn>;
  let getBalance: ReturnType<typeof vi.fn>;
  let record: ReturnType<typeof vi.fn>;
  let spentRubSince: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let config: {
    polzaAiEnabled: boolean;
    polzaAiModel: string;
    polzaAiModels: Map<string, string>;
    polzaAiModelFor: (purpose: string) => string | undefined;
    aiUserDailyLimitRub: number;
  };
  let service: AiService;

  beforeEach(async () => {
    chatCompletion = vi.fn().mockResolvedValue(RESULT);
    getBalance = vi.fn().mockResolvedValue({ amount: 900, available: 850 });
    record = vi.fn().mockResolvedValue(undefined);
    spentRubSince = vi.fn().mockResolvedValue(0);
    report = vi.fn().mockResolvedValue(undefined);
    config = {
      polzaAiEnabled: true,
      polzaAiModel: 'default/model',
      polzaAiModels: new Map(),
      // Та же логика, что у AppConfigService.polzaAiModelFor: override ?? умолчание.
      polzaAiModelFor: (purpose) => config.polzaAiModels.get(purpose) ?? config.polzaAiModel,
      aiUserDailyLimitRub: 50,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PolzaClient, useValue: { chatCompletion, getBalance } },
        { provide: AiUsageService, useValue: { record, spentRubSince } },
        { provide: AppConfigService, useValue: config },
        { provide: ErrorReporter, useValue: { report } },
      ],
    }).compile();
    service = moduleRef.get(AiService);
  });

  describe('барьеры до HTTP', () => {
    it('закрытая фича — AiFeatureDisabledError, ни одного вызова Polza и ни строки учёта', async () => {
      await expect(
        service.complete({ ...CTX, aiAllowed: false }, REQUEST, NOW),
      ).rejects.toBeInstanceOf(AiFeatureDisabledError);
      expect(chatCompletion).not.toHaveBeenCalled();
      expect(spentRubSince).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('без telegramUserId бросает, до Polza не доходит', async () => {
      await expect(service.complete({ ...CTX, telegramUserId: '' }, REQUEST, NOW)).rejects.toThrow(
        /telegramUserId/,
      );
      await expect(service.complete(undefined as never, REQUEST, NOW)).rejects.toThrow(
        /telegramUserId/,
      );
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('без purpose бросает', async () => {
      await expect(service.complete({ ...CTX, purpose: '' }, REQUEST, NOW)).rejects.toThrow(
        /purpose/,
      );
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('ИИ выключен на сервере — AiUnavailableError без запроса', async () => {
      config.polzaAiEnabled = false;
      await expect(service.complete(CTX, REQUEST, NOW)).rejects.toBeInstanceOf(AiUnavailableError);
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('лимит исчерпан — AiDailyLimitError без запроса; окно — московские сутки', async () => {
      spentRubSince.mockResolvedValue(50);
      const error = await service.complete(CTX, REQUEST, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiDailyLimitError);
      expect((error as AiDailyLimitError).userMessage).toMatch(/лимит/i);
      expect(chatCompletion).not.toHaveBeenCalled();
      expect(spentRubSince).toHaveBeenCalledWith('42', moscowDayStart(NOW));
      expect(moscowDayStart(NOW).toISOString()).toBe('2026-10-13T21:00:00.000Z');
    });

    it('ниже лимита — запрос идёт', async () => {
      spentRubSince.mockResolvedValue(49.99);
      await expect(service.complete(CTX, REQUEST, NOW)).resolves.toBe(RESULT);
    });

    it('лимит 0 — без лимита, сумма даже не запрашивается', async () => {
      config.aiUserDailyLimitRub = 0;
      await service.complete(CTX, REQUEST, NOW);
      expect(spentRubSince).not.toHaveBeenCalled();
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('сумму не прочитать (Mongo лежит) — отказ без запроса', async () => {
      spentRubSince.mockRejectedValue(new Error('connection refused'));
      await expect(service.complete(CTX, REQUEST, NOW)).rejects.toBeInstanceOf(AiUnavailableError);
      expect(chatCompletion).not.toHaveBeenCalled();
    });
  });

  describe('учёт AiUsage', () => {
    it('успех: costRub и токены — из usage ответа как есть, модели обе', async () => {
      await expect(service.complete(CTX, REQUEST, NOW)).resolves.toBe(RESULT);
      // Модель уходит явно — та же, что пишется в строку учёта.
      expect(chatCompletion).toHaveBeenCalledWith({ ...REQUEST, model: 'default/model' });
      expect(record).toHaveBeenCalledTimes(1);
      const row = record.mock.calls[0][0];
      expect(row).toMatchObject({
        telegramUserId: '42',
        purpose: 'check',
        model: 'default/model',
        responseModel: RESULT.model,
        provider: '',
        promptTokens: 12,
        completionTokens: 34,
        totalTokens: 46,
        cachedTokens: 2,
        reasoningTokens: 5,
        traceId: RESULT.traceId,
        status: 'ok',
        httpStatus: null,
        errorCode: null,
      });
      expect(row.costRub).toBe(RESULT.usage.costRub);
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('модель запроса важнее POLZA_AI_MODEL', async () => {
      await service.complete(CTX, { ...REQUEST, model: 'openai/gpt-4o-mini' }, NOW);
      expect(record.mock.calls[0][0].model).toBe('openai/gpt-4o-mini');
    });

    it('модель по назначению (POLZA_AI_MODELS): она и уходит в Polza, и пишется в строку', async () => {
      config.polzaAiModels.set('check', 'cheap/model');
      await service.complete(CTX, REQUEST, NOW);
      expect(chatCompletion).toHaveBeenCalledWith({ ...REQUEST, model: 'cheap/model' });
      expect(record.mock.calls[0][0].model).toBe('cheap/model');
    });

    it('модель по назначению попадает и в строку упавшего запроса', async () => {
      config.polzaAiModels.set('check', 'cheap/model');
      chatCompletion.mockRejectedValue(new Error('сеть'));
      await service.complete(CTX, REQUEST, NOW).catch(() => undefined);
      expect(record.mock.calls[0][0]).toMatchObject({ status: 'error', model: 'cheap/model' });
    });

    it('чужое назначение берёт модель по умолчанию', async () => {
      config.polzaAiModels.set('analyst', 'strong/model');
      await service.complete(CTX, REQUEST, NOW);
      expect(chatCompletion).toHaveBeenCalledWith({ ...REQUEST, model: 'default/model' });
    });

    it('модель запроса важнее модели по назначению', async () => {
      config.polzaAiModels.set('check', 'cheap/model');
      await service.complete(CTX, { ...REQUEST, model: 'explicit/model' }, NOW);
      expect(chatCompletion).toHaveBeenCalledWith({ ...REQUEST, model: 'explicit/model' });
      expect(record.mock.calls[0][0].model).toBe('explicit/model');
    });

    it('текста промпта и ответа в строке нет', async () => {
      await service.complete(CTX, REQUEST, NOW);
      const row = record.mock.calls[0][0];
      expect(row).not.toHaveProperty('messages');
      expect(row).not.toHaveProperty('content');
      const dump = JSON.stringify(row);
      expect(dump).not.toContain('секретный промпт');
      expect(dump).not.toContain('секретный ответ');
    });

    it('упавшая запись учёта (Mongo) не ломает ответ', async () => {
      record.mockRejectedValue(new Error('Mongo down'));
      await expect(service.complete(CTX, REQUEST, NOW)).resolves.toBe(RESULT);
    });

    it('402: строка error с httpStatus/errorCode/traceId, алерт админам, ошибка уходит наверх', async () => {
      const error = new PolzaInsufficientFundsError(
        'Недостаточно средств',
        402,
        'INSUFFICIENT_BALANCE',
        'trace_402',
      );
      chatCompletion.mockRejectedValue(error);

      const thrown = await service.complete(CTX, REQUEST, NOW).catch((e: unknown) => e);
      expect(thrown).toBe(error);
      expect((thrown as PolzaApiError).userMessage).toMatch(/недоступен/);

      expect(record.mock.calls[0][0]).toMatchObject({
        status: 'error',
        httpStatus: 402,
        errorCode: 'INSUFFICIENT_BALANCE',
        traceId: 'trace_402',
        costRub: 0,
        model: 'default/model',
      });
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          source: 'polza',
          context: 'ai:check',
          telegramUserId: '42',
          alert: true,
        }),
      );
    });

    it('403 (модерация) пишется, но админов не будит', async () => {
      chatCompletion.mockRejectedValue(new PolzaModerationError('moderation', 403, 'FORBIDDEN'));
      await expect(service.complete(CTX, REQUEST, NOW)).rejects.toBeInstanceOf(
        PolzaModerationError,
      );
      expect(record.mock.calls[0][0]).toMatchObject({ status: 'error', httpStatus: 403 });
      expect(report.mock.calls[0][0].alert).toBe(false);
    });

    it('сетевой сбой: httpStatus null, повтора нет', async () => {
      chatCompletion.mockRejectedValue(new PolzaNetworkError('timeout of 620000ms exceeded'));
      await expect(service.complete(CTX, REQUEST, NOW)).rejects.toBeInstanceOf(PolzaNetworkError);
      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0]).toMatchObject({ status: 'error', httpStatus: null });
      expect(report.mock.calls[0][0].alert).toBe(true);
    });
  });

  describe('balance — системный запрос самопроверки', () => {
    it('без продавца, фичи и лимита: ни строки учёта, ни отчёта', async () => {
      await expect(service.balance()).resolves.toMatchObject({ available: 850 });
      expect(getBalance).toHaveBeenCalledTimes(1);
      expect(spentRubSince).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    });

    it('сбой Polza пробрасывается без отчёта — судит монитор по shouldNotify', async () => {
      const error = new PolzaInsufficientFundsError('no money', 402, 'INSUFFICIENT_BALANCE');
      getBalance.mockRejectedValue(error);
      await expect(service.balance()).rejects.toBe(error);
      expect(report).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('без токена — AiUnavailableError до HTTP', async () => {
      config.polzaAiEnabled = false;
      await expect(service.balance()).rejects.toBeInstanceOf(AiUnavailableError);
      expect(getBalance).not.toHaveBeenCalled();
    });
  });
  describe('completeWithTools (TASK-147)', () => {
    const ANSWER = { ...RESULT, content: 'Чистая 1000 ₽', toolCalls: [], finishReason: 'stop' };
    const asks = (...names: string[]) => ({
      ...RESULT,
      content: '',
      finishReason: 'tool_calls',
      toolCalls: names.map((name, i) => ({ id: `call_${i}`, name, arguments: '{}' })),
    });
    const toolbox = (telegramUserId = CTX.telegramUserId) => ({
      telegramUserId,
      definitions: [
        {
          type: 'function' as const,
          function: { name: 'getPnl', description: 'P&L', parameters: { type: 'object' } },
        },
      ],
      call: vi.fn().mockResolvedValue({
        ok: true,
        data: { net: 1000 },
        sourceRefs: { source: 'finance:pnl', operationIds: ['op1'], operationCount: 1 },
      }),
    });

    it('закрытая фича ai — отказ до HTTP: ни Polza, ни инструмента, ни строки AiUsage', async () => {
      const tools = toolbox();
      await expect(
        service.completeWithTools({ ...CTX, aiAllowed: false }, REQUEST, tools, NOW),
      ).rejects.toBeInstanceOf(AiFeatureDisabledError);
      expect(chatCompletion).not.toHaveBeenCalled();
      expect(tools.call).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('исчерпан лимит — отказ на первом раунде, инструменты не зовутся', async () => {
      spentRubSince.mockResolvedValue(50);
      const tools = toolbox();
      await expect(service.completeWithTools(CTX, REQUEST, tools, NOW)).rejects.toBeInstanceOf(
        AiDailyLimitError,
      );
      expect(tools.call).not.toHaveBeenCalled();
    });

    it('инструменты чужого продавца — ошибка программиста до любого запроса', async () => {
      await expect(service.completeWithTools(CTX, REQUEST, toolbox('999'), NOW)).rejects.toThrow(
        /другого продавца/,
      );
      await expect(
        service.completeWithTools(CTX, REQUEST, undefined as never, NOW),
      ).rejects.toThrow(/набор инструментов/);
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('вызов → результат инструмента → ответ; строка AiUsage на каждый раунд', async () => {
      chatCompletion.mockResolvedValueOnce(asks('getPnl')).mockResolvedValueOnce(ANSWER);
      const tools = toolbox();
      const result = await service.completeWithTools(CTX, REQUEST, tools, NOW);

      expect(result.content).toBe('Чистая 1000 ₽');
      expect(result.rounds).toBe(2);
      expect(tools.call).toHaveBeenCalledWith('getPnl', '{}');
      expect(result.toolResults).toEqual([
        { name: 'getPnl', arguments: '{}', result: await tools.call.mock.results[0].value },
      ]);
      expect(record).toHaveBeenCalledTimes(2);
      expect(spentRubSince).toHaveBeenCalledTimes(2);
      // Стоимость — сумма раундов, а не usage последнего.
      expect(result.costRub).toBeCloseTo(2 * RESULT.usage.costRub, 10);

      const first = chatCompletion.mock.calls[0][0];
      expect(first.tools).toBe(tools.definitions);
      expect(first.toolChoice).toBe('auto');
      const second = chatCompletion.mock.calls[1][0];
      expect(second.messages.slice(1)).toEqual([
        { role: 'assistant', content: null, toolCalls: asks('getPnl').toolCalls },
        {
          role: 'tool',
          toolCallId: 'call_0',
          content: JSON.stringify(await tools.call.mock.results[0].value),
        },
      ]);
      // Исходный запрос не мутирован.
      expect(REQUEST.messages).toHaveLength(1);
    });

    it('модель зовёт инструменты по кругу — последний раунд без них, toolChoice none', async () => {
      chatCompletion.mockResolvedValue(asks('getPnl'));
      const tools = toolbox();
      const result = await service.completeWithTools(CTX, REQUEST, tools, NOW);

      expect(result.rounds).toBe(MAX_TOOL_ROUNDS + 1);
      expect(chatCompletion).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
      expect(tools.call).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
      expect(chatCompletion.mock.calls[MAX_TOOL_ROUNDS][0].toolChoice).toBe('none');
    });

    it('лишние вызовы раунда и брошенный инструмент — ошибка модели, не обрыв диалога', async () => {
      const many = Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 1 }, () => 'getPnl');
      chatCompletion.mockResolvedValueOnce(asks(...many)).mockResolvedValueOnce(ANSWER);
      const tools = toolbox();
      tools.call.mockRejectedValueOnce(new Error('база легла'));
      const result = await service.completeWithTools(CTX, REQUEST, tools, NOW);

      expect(tools.call).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_ROUND);
      expect(result.toolResults).toHaveLength(MAX_TOOL_CALLS_PER_ROUND + 1);
      expect(result.toolResults[0].result).toEqual({
        ok: false,
        error: 'Инструмент не ответил: база легла',
      });
      expect(result.toolResults[MAX_TOOL_CALLS_PER_ROUND].result).toMatchObject({ ok: false });
      // На каждый вызов — сообщение tool с его id.
      const toolMessages = chatCompletion.mock.calls[1][0].messages.filter(
        (m: { role: string }) => m.role === 'tool',
      );
      expect(toolMessages).toHaveLength(MAX_TOOL_CALLS_PER_ROUND + 1);
    });

    it('потолок раунда (TASK-166): зависший инструмент — честный отказ, следующий вызов раунда не запускается', async () => {
      vi.useFakeTimers();
      try {
        chatCompletion
          .mockResolvedValueOnce(asks('getStocks', 'getReturns'))
          .mockResolvedValueOnce(ANSWER);
        const tools = toolbox();
        // Маркет не отвечает вовсе — промис не завершится никогда.
        tools.call.mockImplementationOnce(() => new Promise(() => undefined));
        const pending = service.completeWithTools(CTX, REQUEST, tools, NOW);
        await vi.advanceTimersByTimeAsync(AI_TOOL_ROUND_TIMEOUT_MS);
        const result = await pending;

        expect(tools.call).toHaveBeenCalledTimes(1);
        expect(result.toolResults.map((r) => r.result)).toEqual([
          { ok: false, error: TOOL_TIMEOUT_TEXT },
          { ok: false, error: TOOL_TIMEOUT_TEXT },
        ]);
        // Ход завершился ответом модели, а не висит и не падает.
        expect(result.content).toBe('Чистая 1000 ₽');
        expect(result.rounds).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
