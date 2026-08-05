import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ITariffReportJob } from '../../src/modules/telegram/queue/processors/tariff-report.processor';

import { TariffReportProcessor } from '../../src/modules/telegram/queue/processors/tariff-report.processor';
import { DEFAULT_PERIOD } from '../../src/modules/yandex/reports/report-period';
import { YandexAuthError } from '../../src/modules/yandex/yandex-api.errors';

/**
 * Экран «Калькулятор» в фоне — по тем же обещаниям, что «Прибыль»: креды из
 * Mongo (в payload их нет), период из джобы как есть, ошибка гасится с ответом
 * продавцу (attempts: 1, повтор жёг бы квоту Partner API).
 *
 * Флага фичи в джобе нет намеренно: он решает, доступен ли экран вообще, и
 * проверен гейтом и хендлером ДО постановки в очередь.
 */
describe('TariffReportProcessor', () => {
  let buildTariffReport: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let findByTelegramId: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let processor: TariffReportProcessor;

  const CALC_RESULT = {
    period: DEFAULT_PERIOD,
    ordersCount: 5,
    revenue: 10_000,
    commissionPercent: 16,
    estimate: {
      scope: 'placed' as const,
      servicesTotal: 2400,
      byService: { FEE: 1500, DELIVERY_TO_CUSTOMER: 900 },
      coveredOrders: 5,
      totalOrders: 5,
      coveredRevenue: 10_000,
    },
  };

  const jobData: ITariffReportJob = {
    botId: 999,
    chatId: '222',
    telegramUserId: '222',
    period: DEFAULT_PERIOD,
  };

  const jobWith = (data: Partial<ITariffReportJob> = {}) =>
    ({ id: 1, name: 'send-tariff-report', data: { ...jobData, ...data } }) as never;

  beforeEach(() => {
    buildTariffReport = vi.fn(async () => CALC_RESULT);
    findByTelegramUser = vi.fn(async () => ({
      campaign_id: 'c',
      business_id: 'b',
      token: 'ACMA:x',
    }));
    sendMessage = vi.fn(async () => undefined);
    findByTelegramId = vi.fn(() => ({ telegraf: { telegram: { sendMessage } } }));
    report = vi.fn(async () => undefined);

    processor = new TariffReportProcessor(
      { findByTelegramId } as never,
      { findByTelegramUser } as never,
      { buildTariffReport } as never,
      { report } as never,
    );
  });

  it('happy path: store из Mongo, экран с разбивкой уходит в чат', async () => {
    await processor.run(jobWith());

    expect(buildTariffReport).toHaveBeenCalledWith(
      await findByTelegramUser.mock.results[0].value,
      DEFAULT_PERIOD,
    );

    const [chatId, text] = sendMessage.mock.calls[0];
    expect(chatId).toBe('222');
    expect(text).toContain('Услуги Маркета');
    expect(text).toContain('Размещение на Маркете');
  });

  it('период берётся из джобы', async () => {
    await processor.run(jobWith({ period: { key: 'month' } as never }));

    expect(buildTariffReport).toHaveBeenCalledWith(expect.anything(), { key: 'month' });
  });

  it('нет кред — продавцу говорят, расчёт не запускается', async () => {
    findByTelegramUser.mockResolvedValue(null);

    await processor.run(jobWith());

    expect(buildTariffReport).not.toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).toContain('Настройки магазина не найдены');
  });

  it('бот не зарегистрирован — выходим молча', async () => {
    findByTelegramId.mockReturnValue(null);

    await expect(processor.run(jobWith())).resolves.toBeUndefined();
    expect(buildTariffReport).not.toHaveBeenCalled();
  });

  it('расчёт упал — ошибка гасится, продавец получает текст', async () => {
    // Экран калькулятора об ошибке ГОВОРИТ, в отличие от строки-сверки внутри
    // «Прибыли», которая при сбое просто исчезает.
    buildTariffReport.mockRejectedValue(new Error('boom'));

    await expect(processor.run(jobWith())).resolves.toBeUndefined();

    expect(report).toHaveBeenCalled();
    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('Не удалось собрать отчёт');
  });

  it('доменная ошибка показывается своим текстом', async () => {
    buildTariffReport.mockRejectedValue(new YandexAuthError('unauthorized', 401));

    await processor.run(jobWith());

    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain('отклонил ваш API-токен');
  });
});
