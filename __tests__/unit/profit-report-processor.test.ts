import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IProfitReportJob } from '../../src/modules/telegram/queue/processors/profit-report.processor';

import { ProfitReportProcessor } from '../../src/modules/telegram/queue/processors/profit-report.processor';
import { DEFAULT_PERIOD } from '../../src/modules/yandex/reports/report-period';
import { YandexAuthError } from '../../src/modules/yandex/yandex-api.errors';

/**
 * «Прибыль» в фоне: самый дорогой отчёт больше не держит цикл апдейтов
 * telegraf. Обещания процессора — креды из Mongo (в payload их нет), период и
 * флаг калькулятора берутся из джобы как есть, ошибка гасится с ответом
 * продавцу (attempts: 1, повтор жёг бы квоту Partner API).
 */
describe('ProfitReportProcessor', () => {
  let build: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let findByTelegramId: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let processor: ProfitReportProcessor;

  const PROFIT_RESULT = {
    period: DEFAULT_PERIOD,
    pricesUpdatedAt: new Date('2026-07-29T10:00:00Z'),
    totals: {
      revenue: 10000,
      commission: 2300,
      tax: 700,
      purchase: 5000,
      net: 2000,
      orders: 1,
      excludedOrders: 0,
      excludedRevenue: 0,
      unknownSkus: [],
      returnedOrders: 0,
      returnedRevenue: 0,
      rates: {
        commissionPercent: 23,
        taxPercent: 7,
        discountPercent: 10,
        vostokDiscountPercent: 4,
      },
    },
  };

  const jobData: IProfitReportJob = {
    botId: 999,
    chatId: '222',
    telegramUserId: '222',
    period: DEFAULT_PERIOD,
    tariffEstimate: false,
  };

  const jobWith = (data: Partial<IProfitReportJob> = {}) =>
    ({ id: 1, name: 'send-profit-report', data: { ...jobData, ...data } }) as never;

  beforeEach(() => {
    build = vi.fn(async () => PROFIT_RESULT);
    findByTelegramUser = vi.fn(async () => ({ campaign_id: 'c', business_id: 'b', token: 'ACMA:x' }));
    sendMessage = vi.fn(async () => undefined);
    findByTelegramId = vi.fn(() => ({ telegraf: { telegram: { sendMessage } } }));
    report = vi.fn(async () => undefined);

    processor = new ProfitReportProcessor(
      { findByTelegramId } as never,
      { findByTelegramUser } as never,
      { build } as never,
      { report } as never,
    );
  });

  it('happy path: store из Mongo, отчёт уходит в чат', async () => {
    await processor.run(jobWith());

    expect(build).toHaveBeenCalledWith(
      await findByTelegramUser.mock.results[0].value,
      DEFAULT_PERIOD,
      expect.any(Date),
      { tariffEstimate: false },
    );

    const [chatId, text] = sendMessage.mock.calls[0];
    expect(chatId).toBe('222');
    expect(text).toContain('Продажи');
    expect(text).toContain('Чистая');
  });

  it('период и флаг калькулятора берутся из джобы', async () => {
    await processor.run(jobWith({ period: { key: 'month' } as never, tariffEstimate: true }));

    expect(build).toHaveBeenCalledWith(expect.anything(), { key: 'month' }, expect.any(Date), {
      tariffEstimate: true,
    });
  });

  it('нет кред — продавцу говорят, расчёт не запускается', async () => {
    findByTelegramUser.mockResolvedValue(null);

    await processor.run(jobWith());

    expect(build).not.toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).toContain('Настройки магазина не найдены');
  });

  it('бот не зарегистрирован — выходим молча', async () => {
    findByTelegramId.mockReturnValue(null);

    await expect(processor.run(jobWith())).resolves.toBeUndefined();
    expect(build).not.toHaveBeenCalled();
  });

  it('расчёт упал — ошибка гасится, продавец получает текст', async () => {
    build.mockRejectedValue(new Error('boom'));

    await expect(processor.run(jobWith())).resolves.toBeUndefined();

    expect(report).toHaveBeenCalled();
    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('Не удалось собрать отчёт');
  });

  it('доменная ошибка показывается своим текстом', async () => {
    build.mockRejectedValue(new YandexAuthError('unauthorized', 401));

    await processor.run(jobWith());

    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('отклонил ваш API-токен');
  });
});
