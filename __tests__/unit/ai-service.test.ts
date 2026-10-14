import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AiUsageService } from '../../src/database/services/ai-usage.service';
import {
  AiDailyLimitError,
  AiFeatureDisabledError,
  AiUnavailableError,
} from '../../src/modules/ai/ai.errors';
import { AiService } from '../../src/modules/ai/ai.service';
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
  let config: { polzaAiEnabled: boolean; polzaAiModel: string; aiUserDailyLimitRub: number };
  let service: AiService;

  beforeEach(async () => {
    chatCompletion = vi.fn().mockResolvedValue(RESULT);
    getBalance = vi.fn().mockResolvedValue({ amount: 900, available: 850 });
    record = vi.fn().mockResolvedValue(undefined);
    spentRubSince = vi.fn().mockResolvedValue(0);
    report = vi.fn().mockResolvedValue(undefined);
    config = { polzaAiEnabled: true, polzaAiModel: 'default/model', aiUserDailyLimitRub: 50 };

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
      expect(chatCompletion).toHaveBeenCalledWith(REQUEST);
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
});
