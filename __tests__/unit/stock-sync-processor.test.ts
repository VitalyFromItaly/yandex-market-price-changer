import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { IStockSyncJob } from '../../src/modules/telegram/queue/processors/stock-sync.processor';

import { StockSyncProcessor } from '../../src/modules/telegram/queue/processors/stock-sync.processor';
import { YandexApiError } from '../../src/modules/yandex/yandex-api.errors';

/**
 * Обработка прайса в фоне — вне цикла апдейтов telegraf.
 *
 * Ключевые обещания: креды перечитываются из Mongo (в payload их нет), отчёт
 * уходит тем же formatStockReport, что и раньше, а ошибка ГАСИТСЯ с ответом
 * продавцу — attempts: 1, пробросить значило бы оставить его без ответа.
 */
describe('StockSyncProcessor', () => {
  let sync: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let findByTelegramId: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let getFileLink: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let processor: StockSyncProcessor;

  const jobData: IStockSyncJob = {
    botId: 999,
    chatId: '222',
    telegramUserId: '222',
    fileId: 'f',
    fileName: 'stock.xlsx',
    dryRun: false,
    savePurchasePrices: true,
    stockWriteAllowed: true,
  };

  const jobWith = (data: Partial<IStockSyncJob> = {}) =>
    ({ id: 1, name: 'sync-stocks', data: { ...jobData, ...data } }) as never;

  const syncResult = {
    totalRows: 2,
    matched: 1,
    zeroed: 0,
    updated: 1,
    skipped: [],
    matchedBy: {},
    errors: [],
    dryRun: false,
    catalogSize: 10,
    purchasePricesSaved: 1,
  };

  beforeEach(() => {
    sync = vi.fn(async () => syncResult);
    findByTelegramUser = vi.fn(async () => ({
      campaign_id: 'c1',
      business_id: 'b1',
      token: 'ACMA:x',
    }));
    sendMessage = vi.fn(async () => undefined);
    getFileLink = vi.fn(async () => ({ href: 'https://example.invalid/file.xlsx' }));
    findByTelegramId = vi.fn(() => ({
      telegraf: { telegram: { sendMessage, getFileLink } },
    }));
    report = vi.fn(async () => undefined);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );

    processor = new StockSyncProcessor(
      { findByTelegramId } as never,
      { findByTelegramUser } as never,
      { sync } as never,
      { report } as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('happy path: креды из Mongo, отчёт уходит в чат', async () => {
    await processor.run(jobWith());

    // Файл скачан по file_id — буфера в payload нет.
    expect(getFileLink).toHaveBeenCalledWith('f');

    expect(sync).toHaveBeenCalledWith(
      { token: 'ACMA:x', campaignId: 'c1', businessId: 'b1' },
      expect.any(Buffer),
      { dryRun: false, telegramUserId: '222', savePurchasePrices: true, stockWriteAllowed: true },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendMessage.mock.calls[0];
    expect(chatId).toBe('222');
    expect(text).toContain('Остатки обновлены');
  });

  it('опции джобы доезжают до sync (dryRun, выключенные фичи)', async () => {
    await processor.run(jobWith({ dryRun: true, savePurchasePrices: false }));

    expect(sync).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true, savePurchasePrices: false }),
    );
  });

  it('нет кред — продавцу говорят, sync не вызывается', async () => {
    findByTelegramUser.mockResolvedValue(null);

    await processor.run(jobWith());

    expect(sync).not.toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).toContain('Настройки магазина не найдены');
  });

  it('бот не зарегистрирован — выходим молча, не падаем', async () => {
    findByTelegramId.mockReturnValue(null);

    await expect(processor.run(jobWith())).resolves.toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });

  it('sync упал — ошибка гасится, продавец получает текст, журнал пополняется', async () => {
    sync.mockRejectedValue(new Error('boom'));

    // НЕ пробрасываем: attempts=1, повтор жёг бы квоту Partner API.
    await expect(processor.run(jobWith())).resolves.toBeUndefined();

    expect(report).toHaveBeenCalled();
    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('Не удалось обработать файл');
  });

  it('YandexApiError — продавец видит userMessage, а не общий текст', async () => {
    sync.mockRejectedValue(new YandexApiError('upstream', 500));

    await processor.run(jobWith());

    const text = String(sendMessage.mock.calls.at(-1)?.[1]);
    expect(text).toContain('Не удалось получить данные из Яндекс.Маркета');
    expect(text).not.toContain('Не удалось обработать файл');
  });

  it('не смогли ответить (403) — процессор всё равно не падает', async () => {
    sync.mockRejectedValue(new Error('boom'));
    sendMessage.mockRejectedValue(new Error('403: bot was blocked by the user'));

    await expect(processor.run(jobWith())).resolves.toBeUndefined();
  });
});
