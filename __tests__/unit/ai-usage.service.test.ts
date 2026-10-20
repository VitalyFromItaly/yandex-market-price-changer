import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  AI_USAGE_TTL_DAYS,
  AiUsage,
  AiUsageSchema,
} from '../../src/database/schemas/ai-usage.schema';
import { AI_EVAL_PURPOSE, AiUsageService } from '../../src/database/services/ai-usage.service';
import type { IAiUsageRow } from '../../src/database/services/ai-usage.service';

const ROW: IAiUsageRow = {
  telegramUserId: '42',
  purpose: 'check',
  model: 'm',
  responseModel: 'm',
  provider: '',
  promptTokens: 1,
  completionTokens: 1,
  totalTokens: 2,
  cachedTokens: 0,
  reasoningTokens: 0,
  costRub: 0.1,
  durationMs: 10,
  traceId: 'gen_1',
  status: 'ok',
  httpStatus: null,
  errorCode: null,
};

describe('AiUsageService', () => {
  let create: ReturnType<typeof vi.fn>;
  let aggregate: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;
  let countDocuments: ReturnType<typeof vi.fn>;
  let chain: Record<string, ReturnType<typeof vi.fn>>;
  let service: AiUsageService;

  beforeEach(async () => {
    create = vi.fn().mockResolvedValue({});
    aggregate = vi.fn(() => ({ exec: async () => [{ total: 12.5 }] }));
    chain = {
      sort: vi.fn(() => chain),
      skip: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      lean: vi.fn(() => chain),
      exec: vi.fn(async () => []),
    };
    find = vi.fn(() => chain);
    countDocuments = vi.fn(() => ({ exec: async () => 7 }));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiUsageService,
        {
          provide: getModelToken(AiUsage.name),
          useValue: { create, aggregate, find, countDocuments },
        },
      ],
    }).compile();
    service = moduleRef.get(AiUsageService);
  });

  it('record никогда не бросает', async () => {
    create.mockRejectedValue(new Error('Mongo down'));
    await expect(service.record(ROW)).resolves.toBeUndefined();
  });

  it('spentRubSince суммирует costRub продавца с начала окна, без контрольного набора', async () => {
    const since = new Date('2026-10-13T21:00:00Z');
    await expect(service.spentRubSince('42', since)).resolves.toBe(12.5);
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({
      $match: {
        telegramUserId: '42',
        purpose: { $ne: AI_EVAL_PURPOSE },
        createdAt: { $gte: since },
      },
    });
    expect(AI_EVAL_PURPOSE).toBe('eval');
    expect(pipeline[1].$group.total).toEqual({ $sum: '$costRub' });
  });

  it('нет строк — 0', async () => {
    aggregate.mockReturnValue({ exec: async () => [] });
    await expect(service.spentRubSince('42', new Date())).resolves.toBe(0);
  });

  it('индексы: TTL 180 дней по createdAt и {telegramUserId, createdAt}', () => {
    const indexes = AiUsageSchema.indexes();
    expect(indexes).toContainEqual([{ telegramUserId: 1, createdAt: -1 }, expect.anything()]);
    const ttl = indexes.find(([fields]) => 'createdAt' in fields && !('telegramUserId' in fields));
    expect(ttl?.[1]).toMatchObject({ expireAfterSeconds: AI_USAGE_TTL_DAYS * 24 * 60 * 60 });
    expect(AI_USAGE_TTL_DAYS).toBe(180);
  });

  it('в схеме нет полей для текста промпта и ответа', () => {
    const paths = Object.keys(AiUsageSchema.paths);
    for (const forbidden of ['messages', 'prompt', 'content', 'response', 'text']) {
      expect(paths).not.toContain(forbidden);
    }
  });

  describe('панель «ИИ»', () => {
    it('list и count отбирают одним фильтром', async () => {
      const since = new Date('2026-10-01T00:00:00Z');
      const query = { telegramUserId: '42', purpose: 'check', status: 'error' as const, since };
      await service.list(query);
      await service.count(query);
      const expected = {
        telegramUserId: '42',
        purpose: 'check',
        status: 'error',
        createdAt: { $gte: since },
      };
      expect(find).toHaveBeenCalledWith(expected);
      expect(countDocuments).toHaveBeenCalledWith(expected);
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('страница не больше потолка', async () => {
      await service.list({ limit: 100000 });
      expect(chain.limit).toHaveBeenCalledWith(100);
    });

    it('summary — один aggregate с $facet: Σ costRub и дни по Москве', async () => {
      aggregate.mockReturnValue({
        exec: async () => [
          {
            totals: [
              {
                _id: null,
                costRub: 0.75,
                requests: 3,
                errors: 1,
                promptTokens: 30,
                completionTokens: 9,
                cachedTokens: 2,
              },
            ],
            byDay: [{ _id: '2026-10-14', costRub: 0.75, requests: 3, errors: 1 }],
            byUser: [{ _id: '42', costRub: 0.75, requests: 3, errors: 1 }],
            byPurpose: [{ _id: 'check', costRub: 0.75, requests: 3, errors: 1 }],
          },
        ],
      });
      const since = new Date('2026-10-13T00:00:00Z');
      const until = new Date('2026-10-14T00:00:00Z');
      const summary = await service.summary(since, until);

      expect(aggregate).toHaveBeenCalledTimes(1);
      const [pipeline] = aggregate.mock.calls[0];
      expect(pipeline[0]).toEqual({ $match: { createdAt: { $gte: since, $lte: until } } });
      const facet = pipeline[1].$facet;
      expect(facet.totals[0].$group.costRub).toEqual({ $sum: '$costRub' });
      expect(facet.byDay[0].$group._id.$dateToString.timezone).toBe('Europe/Moscow');

      expect(summary.totals).toEqual({
        costRub: 0.75,
        requests: 3,
        errors: 1,
        promptTokens: 30,
        completionTokens: 9,
        cachedTokens: 2,
      });
      expect(summary.byDay).toEqual([{ day: '2026-10-14', costRub: 0.75, requests: 3, errors: 1 }]);
      expect(summary.byUser[0].telegramUserId).toBe('42');
      expect(summary.byPurpose[0].purpose).toBe('check');
    });

    it('summary пустого окна — нули, а не падение', async () => {
      aggregate.mockReturnValue({
        exec: async () => [{ totals: [], byDay: [], byUser: [], byPurpose: [] }],
      });
      const summary = await service.summary(new Date(), new Date());
      expect(summary.totals.costRub).toBe(0);
      expect(summary.totals.requests).toBe(0);
      expect(summary.byDay).toEqual([]);
    });
  });
});
