import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IWarehousesOverviewJob } from '../../src/modules/telegram/queue/processors/warehouses-overview.processor';

import { WarehousesHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/warehouses.handler';
import { JOB_TYPES } from '../../src/modules/telegram/index';
import { WarehousesOverviewProcessor } from '../../src/modules/telegram/queue/processors/warehouses-overview.processor';
import { YandexApiError } from '../../src/modules/yandex/yandex-api.errors';

/**
 * Обзор складов через очередь: хендлер только проверяет и ставит джобу, сборка —
 * в процессоре. Ключевые обещания: креды в payload не кладутся, второй тап по
 * кнопке не ставит вторую джобу, ошибка сборки гасится с ответом продавцу.
 */
describe('WarehousesHandler: постановка обзора в очередь', () => {
  const FBY_STORE = {
    campaign_id: '148704883',
    business_id: 'b',
    token: 'ACMA:x',
    stores: [{ campaignId: '148704883', businessId: 'b', placementType: 'FBY' }],
  };

  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let queueAdd: ReturnType<typeof vi.fn>;
  let getJobs: ReturnType<typeof vi.fn>;
  let handler: WarehousesHandler;

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

    handler = new WarehousesHandler(
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

    expect(queueAdd).toHaveBeenCalledWith(JOB_TYPES.SEND_WAREHOUSES_OVERVIEW, {
      botId: 999,
      chatId: '222',
      telegramUserId: '222',
    });
    expect(said(ctx)).toContain('Собираю склады');
  });

  it('живая джоба того же продавца — вторая не ставится', async () => {
    getJobs.mockResolvedValue([
      { name: JOB_TYPES.SEND_WAREHOUSES_OVERVIEW, data: { telegramUserId: '222' } },
    ]);

    const ctx = ctxWith();
    await handler.handle(ctx as never);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(said(ctx)).toContain('уже собирается');
  });

  it('сборка сводки FBY постановке НЕ мешает', async () => {
    // Отчёт общий, но лимит его генерации лечится единственным циклом добычи
    // (FbyStockService), а не запретом открыть соседний экран.
    getJobs.mockResolvedValue([
      { name: JOB_TYPES.SEND_FBY_OVERVIEW, data: { telegramUserId: '222' } },
    ]);

    await handler.handle(ctxWith() as never);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('джоба ДРУГОГО продавца постановке не мешает', async () => {
    getJobs.mockResolvedValue([
      { name: JOB_TYPES.SEND_WAREHOUSES_OVERVIEW, data: { telegramUserId: '333' } },
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

    await handler.handle(ctxWith() as never);

    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('WarehousesOverviewProcessor', () => {
  let overview: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let processor: WarehousesOverviewProcessor;

  const jobData: IWarehousesOverviewJob = { botId: 999, chatId: '222', telegramUserId: '222' };
  const jobWith = () => ({ id: 1, name: 'send-warehouses-overview', data: jobData }) as never;

  beforeEach(() => {
    overview = vi.fn(async () => ({
      overview: { fulfillment: [{ id: 100, name: 'Софьино', type: 'fby' }], store: [] },
      byWarehouse: null,
    }));
    findByTelegramUser = vi.fn(async () => ({ campaign_id: 'c', business_id: 'b', token: 't' }));
    sendMessage = vi.fn(async () => undefined);
    report = vi.fn(async () => undefined);

    processor = new WarehousesOverviewProcessor(
      { findByTelegramId: () => ({ telegraf: { telegram: { sendMessage } } }) } as never,
      { findByTelegramUser } as never,
      { overview } as never,
      { report } as never,
    );
  });

  it('happy path: store из Mongo, текст уходит в чат', async () => {
    await processor.run(jobWith());

    expect(overview).toHaveBeenCalledWith(await findByTelegramUser.mock.results[0].value);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe('222');
    expect(String(sendMessage.mock.calls[0][1])).toContain('Софьино');
  });

  it('длинный список режется на несколько сообщений, а не ловит 400', async () => {
    // GET v2/warehouses отдаёт ВСЕ склады Маркета, доступные токену, и с строкой
    // остатков под каждым 4096 символов перестали быть теоретическим потолком.
    overview.mockResolvedValue({
      overview: {
        fulfillment: Array.from({ length: 200 }, (_, idx) => ({
          id: idx,
          name: `Склад номер ${idx} с длинным названием площадки`,
          type: 'fby',
          address: 'Область, район, посёлок, строение 1',
        })),
        store: [],
      },
      byWarehouse: null,
    });

    await processor.run(jobWith());

    expect(sendMessage.mock.calls.length).toBeGreaterThan(1);
    for (const call of sendMessage.mock.calls) expect(String(call[1]).length).toBeLessThanOrEqual(4096);
  });

  it('нет кред — продавцу говорят, overview не зовётся', async () => {
    findByTelegramUser.mockResolvedValue(null);

    await processor.run(jobWith());

    expect(overview).not.toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).toContain('Настройки магазина не найдены');
  });

  it('сборка упала — ошибка гасится, продавец получает текст', async () => {
    overview.mockRejectedValue(new Error('boom'));

    await expect(processor.run(jobWith())).resolves.toBeUndefined();

    expect(report).toHaveBeenCalled();
    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('Не удалось получить список складов');
  });

  it('YandexApiError — продавец видит userMessage', async () => {
    overview.mockRejectedValue(new YandexApiError('upstream', 500));

    await processor.run(jobWith());

    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain(
      'Не удалось получить данные из Яндекс.Маркета',
    );
  });
});
