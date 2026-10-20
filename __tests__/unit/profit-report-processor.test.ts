import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IProfitReportJob } from '../../src/modules/telegram/queue/processors/profit-report.processor';

import { ProfitReportProcessor } from '../../src/modules/telegram/queue/processors/profit-report.processor';
import { DEFAULT_PERIOD } from '../../src/modules/yandex/reports/report-period';
import { YandexAuthError } from '../../src/modules/yandex/yandex-api.errors';
import { unconfirmedOf } from '../../src/shared/profit-confirmation';

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
  let actualNet: ReturnType<typeof vi.fn>;
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
      unconfirmed: unconfirmedOf(0, 0, []),
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
    actualNet = vi.fn(async () => ({
      state: 'verified',
      netKopecks: 123_456,
      unconfirmed: unconfirmedOf(0, 0, []),
      from: '2026-09-01',
      to: '2026-09-30',
    }));

    processor = new ProfitReportProcessor(
      { findByTelegramId } as never,
      { findByTelegramUser } as never,
      { build } as never,
      { actualNet } as never,
      { report } as never,
    );
  });

  it('happy path: store из Mongo, отчёт уходит в чат', async () => {
    await processor.run(jobWith());

    expect(build).toHaveBeenCalledWith(
      await findByTelegramUser.mock.results[0].value,
      DEFAULT_PERIOD,
      expect.any(Date),
      { tariffEstimate: false, deepHistory: false },
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
      deepHistory: false,
    });
  });

  it('profit_actual из джобы — фактическая чистая из журнала в тексте (TASK-126)', async () => {
    await processor.run(jobWith({ period: { key: 'prevmonth' } as never, profitActual: true }));

    expect(actualNet).toHaveBeenCalledWith('222', { key: 'prevmonth' }, expect.any(Date));
    const text = String(sendMessage.mock.calls[0][1]);
    expect(text).toContain('Фактическая чистая');
    expect(text).toContain('1\u00A0235\u00A0₽');
  });

  it('без profit_actual (и в старых джобах) журнал не читается, текст прежний', async () => {
    await processor.run(jobWith());

    expect(actualNet).not.toHaveBeenCalled();
    expect(String(sendMessage.mock.calls[0][1])).not.toContain('Фактическая чистая');
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
