import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FbyStockService } from '../../src/modules/yandex/fby/fby-stock.service';
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
    const [first, second] = await Promise.all([
      service.safeLoad(STORE),
      service.safeLoad(STORE),
    ]);

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
