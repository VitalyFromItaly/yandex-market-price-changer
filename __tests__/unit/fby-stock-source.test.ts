import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  FAILED_RETRIES,
  FbyStockService,
  RETRY_AFTER_FAILED_MS,
} from '../../src/modules/yandex/fby/fby-stock.service';
import { ReportGenerationError } from '../../src/modules/yandex/report-generation.error';

/**
 * Добыча остатков FBY. Проверяем ровно то, ради чего сервис отделён от
 * FbyService: генерация отчёта лимитирована 1/мин на бизнес, а экранов, которым
 * нужен этот отчёт, два. Значит параллельные вызовы обязаны делить одну добычу,
 * повтор в пределах минуты — брать готовый разбор, а отказ НЕ запоминаться.
 */
vi.mock('../../src/modules/yandex/fby/fby-stock-report', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Настоящий разбор — дело fby-stock-report.test.ts; здесь важен только сам
  // факт вызова, а собирать ZIP ради этого значило бы тестировать распаковку.
  parseFbyStockReport: vi.fn(() => ({ totals: {}, problems: [], byWarehouse: {} })),
}));

describe('FbyStockService', () => {
  const STORE = { business_id: 'b1', campaign_id: 'c1', telegramUserId: '222' } as never;
  const OTHER = { business_id: 'b1', campaign_id: 'c2', telegramUserId: '222' } as never;

  let generate: ReturnType<typeof vi.fn>;
  let info: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let service: FbyStockService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T09:00:00Z'));

    generate = vi.fn(async () => 'report-1');
    report = vi.fn(async () => undefined);

    info = vi.fn(async () => ({ status: 'DONE', fileUrl: 'https://x/report.zip' }));
    const client = {
      generateStocksOnWarehousesReport: generate,
      getReportInfo: info,
      downloadReportFile: vi.fn(async () => Buffer.from('zip')),
    };

    service = new FbyStockService({ forStore: () => client } as never, { report } as never);
    // Опрос отчёта ждёт между попытками; здесь ожидание ни при чём.
    Object.assign(service, { sleep: vi.fn(async () => undefined) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('параллельные вызовы делят одну добычу', async () => {
    const [first, second] = await Promise.all([service.safeLoad(STORE), service.safeLoad(STORE)]);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.snapshot).toBe(second.snapshot);
  });

  it('повтор в пределах окна лимита берёт готовый разбор', async () => {
    const first = await service.safeLoad(STORE);
    vi.setSystemTime(new Date('2026-08-01T09:00:59Z'));
    const second = await service.safeLoad(STORE);

    expect(generate).toHaveBeenCalledTimes(1);
    // Момент съёмки прежний — экран обязан показать именно его, а не «сейчас».
    expect(second.snapshot.takenAt).toEqual(first.snapshot.takenAt);
  });

  it('после окна лимита (1 запрос в 2 мин) отчёт запрашивается заново', async () => {
    await service.safeLoad(STORE);
    vi.setSystemTime(new Date('2026-08-01T09:01:01Z'));
    await service.safeLoad(STORE);
    expect(generate).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-08-01T09:02:01Z'));
    await service.safeLoad(STORE);

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('отказ не запоминается — иначе разовый сбой залипал бы на минуту', async () => {
    generate.mockRejectedValueOnce(new Error('boom'));

    const failed = await service.safeLoad(STORE);
    expect(failed.snapshot).toBeNull();
    expect(failed.error).toBe('generic');
    expect(report).toHaveBeenCalled();

    const retried = await service.safeLoad(STORE);
    expect(retried.snapshot).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('лимит генерации — это «подождите», а не поломка: админов не будим', async () => {
    generate.mockRejectedValue(new Error('LIMIT_EXCEEDED: 1 point per 1 minute'));

    const result = await service.safeLoad(STORE);

    expect(result.error).toBe('rate_limit');
    expect(report).not.toHaveBeenCalled();
  });

  it('разные кампании одного бизнеса не делят разбор', async () => {
    await service.safeLoad(STORE);
    await service.safeLoad(OTHER);

    expect(generate).toHaveBeenCalledTimes(2);
  });

  describe('FAILED свежей генерации — повтор новой генерацией', () => {
    // 13.11.2026: 4 провала за секунды из 6 генераций вперемешку с успехами —
    // Маркет роняет отчёт случайно, тот же запрос позже проходит.
    const sleepOf = () => (service as unknown as { sleep: ReturnType<typeof vi.fn> }).sleep;

    it('FAILED → DONE: снимок есть, админов не будим, пауза под лимит генерации', async () => {
      generate.mockResolvedValueOnce('report-1').mockResolvedValueOnce('report-2');
      info.mockResolvedValueOnce({ status: 'FAILED' });

      const result = await service.safeLoad(STORE);

      expect(result.snapshot).not.toBeNull();
      expect(generate).toHaveBeenCalledTimes(2);
      expect(info).toHaveBeenLastCalledWith('report-2');
      expect(sleepOf()).toHaveBeenCalledWith(RETRY_AFTER_FAILED_MS);
      expect(report).not.toHaveBeenCalled();
    });

    it('FAILED → FAILED → DONE: второго повтора хватает', async () => {
      info.mockResolvedValueOnce({ status: 'FAILED' }).mockResolvedValueOnce({ status: 'FAILED' });

      const result = await service.safeLoad(STORE);

      expect(result.snapshot).not.toBeNull();
      expect(generate).toHaveBeenCalledTimes(1 + FAILED_RETRIES);
      expect(report).not.toHaveBeenCalled();
    });

    it('провалились все попытки: один алерт с перечнем прежних отчётов', async () => {
      generate
        .mockResolvedValueOnce('report-1')
        .mockResolvedValueOnce('report-2')
        .mockResolvedValueOnce('report-3');
      info.mockResolvedValue({ status: 'FAILED' });

      const result = await service.safeLoad(STORE);

      expect(result).toEqual({ snapshot: null, error: 'generic' });
      expect(generate).toHaveBeenCalledTimes(3);
      expect(report).toHaveBeenCalledTimes(1);
      const error = report.mock.calls[0][0].error;
      expect(error).toBeInstanceOf(ReportGenerationError);
      expect(error.reportId).toBe('report-3');
      expect(error.message).toContain('после 3 попыток');
      expect(error.message).toContain('report-1, report-2');
    });

    it('продолженный (застрявший) отчёт после FAILED не повторяем', async () => {
      info.mockResolvedValue({ status: 'PENDING' });
      await service.safeLoad(STORE);
      report.mockClear();
      info.mockResolvedValue({ status: 'FAILED' });

      const result = await service.safeLoad(STORE);

      expect(result.snapshot).toBeNull();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledTimes(1);
    });

    it('сбой сети на повторной генерации пробрасывается как есть', async () => {
      generate.mockResolvedValueOnce('report-1').mockRejectedValueOnce(new Error('ECONNRESET'));
      info.mockResolvedValueOnce({ status: 'FAILED' });

      const result = await service.safeLoad(STORE);

      expect(result.error).toBe('generic');
      expect(report.mock.calls[0][0].error.message).toBe('ECONNRESET');
    });
  });

  describe('отчёт, не дождавшийся потолка ожидания', () => {
    // 13-10-2026 Маркет держал отчёт в PENDING 50 минут, а каждое новое нажатие
    // ставило ему в очередь ещё один. Повтор обязан продолжать тот же reportId.
    it('повторный вызов опрашивает тот же отчёт, а не заказывает новый', async () => {
      info.mockResolvedValue({ status: 'PENDING' });
      const stuck = await service.safeLoad(STORE);
      expect(stuck.snapshot).toBeNull();

      info.mockReset();
      info.mockResolvedValue({ status: 'DONE', fileUrl: 'https://x/report.zip' });
      const resumed = await service.safeLoad(STORE);

      expect(resumed.snapshot).not.toBeNull();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith('report-1');
    });

    it('FAILED забывает отчёт: следующий вызов заказывает новый', async () => {
      info.mockResolvedValue({ status: 'PENDING' });
      await service.safeLoad(STORE);
      info.mockResolvedValue({ status: 'FAILED' });
      await service.safeLoad(STORE);
      info.mockResolvedValue({ status: 'DONE', fileUrl: 'https://x/report.zip' });
      await service.safeLoad(STORE);

      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('через час застрявший отчёт уже не ждём', async () => {
      info.mockResolvedValue({ status: 'PENDING' });
      await service.safeLoad(STORE);
      vi.setSystemTime(new Date('2026-08-01T10:01:00Z'));
      info.mockResolvedValue({ status: 'DONE', fileUrl: 'https://x/report.zip' });
      await service.safeLoad(STORE);

      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('в журнал уходит ошибка с reportId', async () => {
      info.mockResolvedValue({ status: 'PENDING', requestedAt: '2026-08-01T09:00:00Z' });
      await service.safeLoad(STORE);

      const error = report.mock.calls[0][0].error;
      expect(error).toBeInstanceOf(ReportGenerationError);
      expect(error.details).toMatchObject({ reportId: 'report-1', status: 'PENDING' });
    });
  });
});
