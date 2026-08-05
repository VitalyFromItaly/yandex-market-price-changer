import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IFbyOverviewJob } from '../../src/modules/telegram/queue/processors/fby-overview.processor';

import { FbyHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/fby.handler';
import { JOB_TYPES } from '../../src/modules/telegram/index';
import { FbyOverviewProcessor } from '../../src/modules/telegram/queue/processors/fby-overview.processor';
import { YandexApiError } from '../../src/modules/yandex/yandex-api.errors';

/**
 * Сводка FBY через очередь: хендлер только проверяет и ставит джобу, сборка —
 * в процессоре. Ключевые обещания: креды в payload не кладутся, второй тап по
 * кнопке не ставит вторую джобу (лимит генерации отчёта 1/мин), ошибка сборки
 * гасится с ответом продавцу.
 */
describe('FbyHandler: постановка сводки в очередь', () => {
  const FBY_STORE = {
    campaign_id: '148704883',
    business_id: 'b',
    token: 'ACMA:x',
    stores: [{ campaignId: '148704883', businessId: 'b', placementType: 'FBY' }],
  };

  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let queueAdd: ReturnType<typeof vi.fn>;
  let getJobs: ReturnType<typeof vi.fn>;
  let handler: FbyHandler;

  const ctxWith = () => ({
    from: { id: 222 },
    botInfo: { id: 999 },
    chat: { id: 222 },
    reply: vi.fn(async () => undefined),
  });

  const said = (ctx: { reply: ReturnType<typeof vi.fn> }) =>
    ctx.reply.mock.calls.map((c) => String(c[0])).join('\n');

  beforeEach(() => {
    findByTelegramUser = vi.fn(async () => FBY_STORE);
    queueAdd = vi.fn(async () => ({ id: 1 }));
    getJobs = vi.fn(async () => []);

    handler = new FbyHandler(
      { findByTelegramUser } as never,
      { report: async () => undefined } as never,
      { replyNeedsStore: vi.fn(async () => undefined) } as never,
      { placementFor: vi.fn(async () => undefined) } as never,
      { add: queueAdd, getJobs } as never,
    );
  });

  it('джоба ставится с payload без токена', async () => {
    const ctx = ctxWith();
    await handler.handle(ctx as never);

    expect(queueAdd).toHaveBeenCalledWith(JOB_TYPES.SEND_FBY_OVERVIEW, {
      botId: 999,
      chatId: '222',
      telegramUserId: '222',
    });
    expect(said(ctx)).toContain('Собираю сводку FBY');
  });

  it('живая джоба того же продавца — вторая не ставится', async () => {
    getJobs.mockResolvedValue([
      { name: JOB_TYPES.SEND_FBY_OVERVIEW, data: { telegramUserId: '222' } },
    ]);

    const ctx = ctxWith();
    await handler.handle(ctx as never);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(said(ctx)).toContain('уже собирается');
  });

  it('джоба ДРУГОГО продавца постановке не мешает', async () => {
    getJobs.mockResolvedValue([
      { name: JOB_TYPES.SEND_FBY_OVERVIEW, data: { telegramUserId: '333' } },
      // Чужие имена джоб той же очереди (дайджест) — тоже не помеха.
      { name: 'send-scheduled-report', data: { telegramUserId: '222' } },
    ]);

    await handler.handle(ctxWith() as never);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('не-FBY магазин — отказ без постановки', async () => {
    findByTelegramUser.mockResolvedValue({
      ...FBY_STORE,
      campaign_id: '148655119',
      stores: [{ campaignId: '148655119', businessId: 'b', placementType: 'FBS' }],
    });

    const ctx = ctxWith();
    await handler.handle(ctx as never);

    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('FbyOverviewProcessor', () => {
  let build: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let findByTelegramId: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let sendDocument: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let processor: FbyOverviewProcessor;

  const jobData: IFbyOverviewJob = { botId: 999, chatId: '222', telegramUserId: '222' };
  const jobWith = () => ({ id: 1, name: 'send-fby-overview', data: jobData }) as never;

  beforeEach(() => {
    build = vi.fn(async () => ({ text: 'сводка' }));
    findByTelegramUser = vi.fn(async () => ({ campaign_id: 'c', business_id: 'b', token: 't' }));
    sendMessage = vi.fn(async () => undefined);
    sendDocument = vi.fn(async () => undefined);
    findByTelegramId = vi.fn(() => ({ telegraf: { telegram: { sendMessage, sendDocument } } }));
    report = vi.fn(async () => undefined);

    processor = new FbyOverviewProcessor(
      { findByTelegramId } as never,
      { findByTelegramUser } as never,
      { build } as never,
      { report } as never,
    );
  });

  it('happy path: store из Mongo, текст уходит в чат', async () => {
    await processor.run(jobWith());

    expect(build).toHaveBeenCalledWith(await findByTelegramUser.mock.results[0].value);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe('222');
    expect(sendMessage.mock.calls[0][1]).toBe('сводка');
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it('проблемные позиции сверх порога — отдельным документом', async () => {
    build.mockResolvedValue({
      text: 'сводка',
      problemExport: { buffer: Buffer.from('x'), filename: 'fby.xlsx' },
    });

    await processor.run(jobWith());

    expect(sendDocument).toHaveBeenCalledWith(
      '222',
      expect.objectContaining({ filename: 'fby.xlsx' }),
    );
  });

  it('нет кред — продавцу говорят, build не зовётся', async () => {
    findByTelegramUser.mockResolvedValue(null);

    await processor.run(jobWith());

    expect(build).not.toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).toContain('Настройки магазина не найдены');
  });

  it('build упал — ошибка гасится, продавец получает текст', async () => {
    build.mockRejectedValue(new Error('boom'));

    await expect(processor.run(jobWith())).resolves.toBeUndefined();

    expect(report).toHaveBeenCalled();
    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('Не удалось собрать сводку FBY');
  });

  it('YandexApiError — продавец видит userMessage', async () => {
    build.mockRejectedValue(new YandexApiError('upstream', 500));

    await processor.run(jobWith());

    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain(
      'Не удалось получить данные из Яндекс.Маркета',
    );
  });
});
