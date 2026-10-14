import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AiUsageService } from '../../src/database/services/ai-usage.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import { AI_BALANCE_TIMEOUT_MS, AiAdminController } from '../../src/modules/ai/ai-admin.controller';
import { AiUnavailableError } from '../../src/modules/ai/ai.errors';
import { AiService } from '../../src/modules/ai/ai.service';
import { PolzaInsufficientFundsError } from '../../src/modules/ai/polza.errors';

const BALANCE = {
  amount: 500,
  available: 480,
  reservedAmount: 20,
  spentAmount: 100,
  updatedAt: null,
};

const ROW = {
  createdAt: new Date('2026-10-14T09:00:00Z'),
  telegramUserId: '222',
  purpose: 'check',
  model: 'm',
  responseModel: 'm',
  provider: '',
  promptTokens: 10,
  completionTokens: 3,
  totalTokens: 13,
  cachedTokens: 0,
  reasoningTokens: 0,
  costRub: 0.25,
  durationMs: 900,
  traceId: 'gen_abc',
  status: 'ok',
  httpStatus: null,
  errorCode: null,
};

describe('AiAdminController', () => {
  let balance: ReturnType<typeof vi.fn>;
  let accessList: ReturnType<typeof vi.fn>;
  let summary: ReturnType<typeof vi.fn>;
  let list: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let controller: AiAdminController;

  beforeEach(async () => {
    balance = vi.fn(async () => BALANCE);
    accessList = vi.fn(async () => [
      { telegramUserId: '222', botId: '999', username: 'vasya', firstName: 'Вася' },
      { telegramUserId: '222', botId: '888', username: 'vasya', firstName: 'Вася' },
    ]);
    summary = vi.fn(async () => ({
      totals: {
        costRub: 0.5,
        requests: 4,
        errors: 1,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
      },
      byDay: [],
      byUser: [
        { telegramUserId: '222', costRub: 0.4, requests: 3, errors: 0 },
        { telegramUserId: '777', costRub: 0.1, requests: 1, errors: 1 },
      ],
      byPurpose: [{ purpose: 'check', costRub: 0.5, requests: 4, errors: 1 }],
    }));
    list = vi.fn(async () => [ROW, { ...ROW, telegramUserId: '777' }]);
    count = vi.fn(async () => 2);

    const moduleRef = await Test.createTestingModule({
      controllers: [AiAdminController],
      providers: [
        { provide: AiUsageService, useValue: { summary, list, count } },
        { provide: UserAccessService, useValue: { list: accessList } },
        { provide: AiService, useValue: { balance } },
        { provide: AdminAuthService, useValue: { verify: async () => '1' } },
      ],
    }).compile();
    controller = moduleRef.get(AiAdminController);
  });

  afterEach(() => vi.useRealTimers());

  it('весь контроллер закрыт гвардом', () => {
    const guards = Reflect.getMetadata('__guards__', AiAdminController) ?? [];
    expect(guards).toContain(AdminJwtGuard);
  });

  it('мусорный range — 400, а не сутки молча', async () => {
    await expect(controller.report('1y')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('сводка: итоги из Mongo, ники одним access.list(), доля ошибок', async () => {
    const report = await controller.report('7d');
    expect(summary).toHaveBeenCalledTimes(1);
    expect(accessList).toHaveBeenCalledTimes(1);
    expect(report.totals.costRub).toBe(0.5);
    expect(report.errorShare).toBe(0.25);
    expect(report.balance).toEqual(BALANCE);
    expect(report.balanceError).toBeNull();
    expect(report.days).toHaveLength(8);
    expect(report.users[0]).toMatchObject({
      telegramUserId: '222',
      username: 'vasya',
      name: 'Вася',
    });
    // Нет в списке доступа (админ) — строка остаётся, просто без ника.
    expect(report.users[1]).toMatchObject({ telegramUserId: '777' });
    expect(report.users[1].username).toBeUndefined();
  });

  it('без ключа — страница открывается, баланс null с причиной', async () => {
    balance.mockRejectedValue(new AiUnavailableError('POLZA_AI_TOKEN не задан'));
    const report = await controller.report('24h');
    expect(report.balance).toBeNull();
    expect(report.balanceError).toContain('POLZA_AI_TOKEN');
    expect(report.totals.costRub).toBe(0.5);
  });

  it('402 — причина словами', async () => {
    balance.mockRejectedValue(new PolzaInsufficientFundsError('no money', 402));
    const report = await controller.report('24h');
    expect(report.balanceError).toContain('402');
  });

  it('баланс висит — ответ после своего таймаута, а не после 620 с клиента', async () => {
    vi.useFakeTimers();
    balance.mockReturnValue(new Promise(() => undefined));
    const pending = controller.report('24h');
    await vi.advanceTimersByTimeAsync(AI_BALANCE_TIMEOUT_MS);
    const report = await pending;
    expect(report.balance).toBeNull();
    expect(report.balanceError).toContain('нет ответа');
  });

  it('журнал: list и count одним запросом-фильтром, ники одним access.list()', async () => {
    const page = await controller.requests('222', undefined, 'ok', '2026-10-01');
    const expected = {
      telegramUserId: '222',
      purpose: undefined,
      status: 'ok',
      since: new Date('2026-10-01'),
      until: undefined,
      limit: undefined,
      skip: undefined,
    };
    expect(list).toHaveBeenCalledWith(expected);
    expect(count).toHaveBeenCalledWith(expected);
    expect(accessList).toHaveBeenCalledTimes(1);
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ traceId: 'gen_abc', username: 'vasya', costRub: 0.25 });
  });

  it('журнал: мусор в status, дате и limit — 400', async () => {
    await expect(controller.requests(undefined, undefined, 'maybe')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.requests(undefined, undefined, undefined, 'вчера'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.requests(undefined, undefined, undefined, undefined, undefined, '-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('пустая страница — access.list() не зовётся', async () => {
    list.mockResolvedValue([]);
    count.mockResolvedValue(0);
    await controller.requests();
    expect(accessList).not.toHaveBeenCalled();
  });

  it('в ответе журнала нет полей текста промпта и ответа', async () => {
    const page = await controller.requests();
    for (const forbidden of ['messages', 'prompt', 'content', 'response', 'text']) {
      expect(Object.keys(page.items[0])).not.toContain(forbidden);
    }
  });
});
