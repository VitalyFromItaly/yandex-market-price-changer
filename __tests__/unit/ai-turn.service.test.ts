import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiTurn, AiTurnSchema } from '../../src/database/schemas/ai-turn.schema';
import { AI_USAGE_TTL_DAYS } from '../../src/database/schemas/ai-usage.schema';
import { AiTurnService } from '../../src/database/services/ai-turn.service';
import { AI_EVAL_PURPOSE } from '../../src/database/services/ai-usage.service';

/** Счётчики хода ИИ и оценка продавца (TASK-170). */
describe('AiTurnService', () => {
  let create: ReturnType<typeof vi.fn>;
  let findOneAndUpdate: ReturnType<typeof vi.fn>;
  let aggregate: ReturnType<typeof vi.fn>;
  let service: AiTurnService;

  const ROW = {
    turnId: 't1',
    telegramUserId: '42',
    purpose: 'analyst',
    numbers: 3,
    unconfirmed: 1,
    toolCalls: 2,
    rounds: 3,
    asksBackNoTools: false,
  };

  beforeEach(async () => {
    create = vi.fn(async (doc: unknown) => doc);
    findOneAndUpdate = vi.fn(() => ({ exec: async () => ({ turnId: 't1' }) }));
    aggregate = vi.fn(() => ({ exec: async () => [] }));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiTurnService,
        { provide: getModelToken(AiTurn.name), useValue: { create, findOneAndUpdate, aggregate } },
      ],
    }).compile();
    service = moduleRef.get(AiTurnService);
  });

  it('в схеме нет полей для текста вопроса и ответа (правило TASK-104)', () => {
    const paths = Object.keys(AiTurnSchema.paths);
    for (const forbidden of [
      'messages',
      'prompt',
      'content',
      'response',
      'text',
      'answer',
      'question',
    ]) {
      expect(paths).not.toContain(forbidden);
    }
    expect(AiTurnSchema.path('rating').options.enum).toEqual(['up', 'down', null]);
  });

  it('индексы: turnId уникален, TTL — срок AiUsage', () => {
    const indexes = AiTurnSchema.indexes();
    expect(indexes).toContainEqual([{ turnId: 1 }, expect.objectContaining({ unique: true })]);
    const ttl = indexes.find(([fields]) => 'createdAt' in fields);
    expect(ttl?.[1]).toMatchObject({ expireAfterSeconds: AI_USAGE_TTL_DAYS * 24 * 60 * 60 });
  });

  it('record — строка без оценки; сбой Mongo не бросает', async () => {
    await service.record(ROW);
    expect(create).toHaveBeenCalledWith({ ...ROW, rating: null, ratedAt: null });
    create.mockRejectedValueOnce(new Error('mongo down'));
    await expect(service.record(ROW)).resolves.toBeUndefined();
  });

  it('rate — фильтр с владельцем и purpose, $set заменяет прежнюю оценку', async () => {
    await expect(service.rate('42', 't1', 'analyst', 'down')).resolves.toBe(true);
    const [filter, update] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ turnId: 't1', telegramUserId: '42', purpose: 'analyst' });
    expect(update.$set.rating).toBe('down');
    expect(update.$set.ratedAt).toBeInstanceOf(Date);

    findOneAndUpdate.mockReturnValueOnce({ exec: async () => null });
    await expect(service.rate('99', 't1', 'analyst', 'up')).resolves.toBe(false);
  });

  it('quality — один aggregate с $facet без контрольного набора, дни по Москве', async () => {
    const counts = { turns: 5, withUnconfirmed: 2, asksBackNoTools: 1, rated: 3, down: 1 };
    aggregate.mockReturnValue({
      exec: async () => [
        {
          byDay: [{ _id: { day: '2026-10-14', purpose: 'analyst' }, ...counts }],
          byPurpose: [{ _id: 'analyst', ...counts }],
        },
      ],
    });
    const since = new Date('2026-10-12T00:00:00Z');
    const until = new Date('2026-10-19T00:00:00Z');
    const result = await service.quality(since, until);

    expect(aggregate).toHaveBeenCalledTimes(1);
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0].$match).toEqual({
      createdAt: { $gte: since, $lte: until },
      purpose: { $ne: AI_EVAL_PURPOSE },
    });
    expect(pipeline[1].$facet.byDay[0].$group._id.day.$dateToString.timezone).toBe('Europe/Moscow');
    expect(result).toEqual({
      byDay: [{ day: '2026-10-14', purpose: 'analyst', ...counts }],
      byPurpose: [{ purpose: 'analyst', ...counts }],
    });
  });

  it('quality — пустое окно', async () => {
    await expect(service.quality(new Date(), new Date())).resolves.toEqual({
      byDay: [],
      byPurpose: [],
    });
  });
});
