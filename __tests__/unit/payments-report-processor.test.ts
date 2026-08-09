import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IPaymentsReportJob } from '../../src/modules/telegram/queue/processors/payments-report.processor';

import { PaymentsReportProcessor } from '../../src/modules/telegram/queue/processors/payments-report.processor';

/**
 * Отчёт по платежам в фоне — по тем же обещаниям, что остальные процессоры
 * очереди reports: креды из Mongo (в payload их нет), период считается НА
 * МОМЕНТ отправки, ошибка гасится с ответом продавцу (attempts: 1).
 */
describe('PaymentsReportProcessor', () => {
  let build: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let sendDocument: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let processor: PaymentsReportProcessor;

  const jobData: IPaymentsReportJob = {
    botId: 999,
    chatId: '222',
    telegramUserId: '111',
    period: 'month',
  };

  const jobWith = (data: Partial<IPaymentsReportJob> = {}) =>
    ({ id: 1, name: 'send-payments-report', data: { ...jobData, ...data } }) as never;

  beforeEach(() => {
    build = vi.fn(async () => ({
      file: { buffer: Buffer.from('xlsx'), filename: 'platezhi.xlsx', caption: 'Платежи' },
    }));
    findByTelegramUser = vi.fn(async () => ({
      campaign_id: 'c',
      business_id: 'b',
      token: 'ACMA:x',
    }));
    sendMessage = vi.fn(async () => undefined);
    sendDocument = vi.fn(async () => undefined);
    report = vi.fn(async () => undefined);

    processor = new PaymentsReportProcessor(
      { findByTelegramId: () => ({ telegraf: { telegram: { sendMessage, sendDocument } } }) } as never,
      { findByTelegramUser } as never,
      { build } as never,
      { report } as never,
    );
  });

  it('happy path: креды из Mongo, файл уходит с подписью', async () => {
    await processor.run(jobWith());

    expect(findByTelegramUser).toHaveBeenCalledWith('111');
    expect(build).toHaveBeenCalledTimes(1);
    // Период превращается в даты в процессоре, а не в хендлере.
    expect(build.mock.calls[0][1]).toMatchObject({
      dateFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
    expect(sendDocument).toHaveBeenCalledWith(
      '222',
      expect.objectContaining({ filename: 'platezhi.xlsx' }),
      expect.objectContaining({ caption: 'Платежи' }),
    );
  });

  it('нет данных за период — сообщение, не пустой файл', async () => {
    build.mockResolvedValueOnce({ file: null });
    await processor.run(jobWith());

    expect(sendDocument).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('222', expect.stringContaining('платежей нет'), {
      parse_mode: 'HTML',
    });
  });

  it('нет магазина — понятный ответ, сборка не запускается', async () => {
    findByTelegramUser.mockResolvedValueOnce(null);
    await processor.run(jobWith());

    expect(build).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('222', expect.stringContaining('⚙️ Настройки'), {
      parse_mode: 'HTML',
    });
  });

  it('сбой сборки гасится: журнал + текст продавцу, джоба не падает', async () => {
    build.mockRejectedValueOnce(new Error('Partner API 500'));
    await expect(processor.run(jobWith())).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('222', expect.stringContaining('❌'), {
      parse_mode: 'HTML',
    });
  });
});
