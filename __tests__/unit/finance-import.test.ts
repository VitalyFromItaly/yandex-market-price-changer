import { strToU8, zipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import {
  financeCorrections,
  financeDiscrepancies,
  financeDocuments,
  financeOperations,
  financePeriods,
} from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import { FinanceAdminController } from '../../src/modules/finance/finance-admin.controller';
import { pairCorrections } from '../../src/modules/finance/finance-corrections';
import {
  FinanceImportService,
  generateWithMinuteLimit,
  NETTING_GENERATE_ATTEMPTS,
  NETTING_GENERATE_PAUSE_MS,
  YM_NETTING_REPORT_TYPE,
} from '../../src/modules/finance/finance-import.service';
import { monthPeriod, parseMonthArg } from '../../src/modules/finance/finance-period';
import { FinanceReconcileService } from '../../src/modules/finance/finance-reconcile.service';
import { nettingRowsOf } from '../../src/modules/finance/ym-journal';
import { YM_UNKNOWN_ARTICLE_CONTEXT } from '../../src/modules/finance/ym-unknown-articles';
import { FinanceImportProcessor } from '../../src/modules/telegram/queue/processors/finance-import.processor';
import { ReportGenerationError } from '../../src/modules/yandex/report-generation.error';
import { YandexRateLimitError } from '../../src/modules/yandex/yandex-api.errors';
import { createTestFinanceDb } from '../helpers/test-postgres';

const SEPTEMBER = monthPeriod(2026, 9);

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 1,
  transactionSum: 1000,
  paymentStatus: 'Будет переведён',
  bankOrderId: null,
  bankOrderDate: null,
  bankSum: null,
  model: 'FBS',
  ...over,
});

const zipOf = (rows: Record<string, unknown>[]) =>
  Buffer.from(zipSync({ 'transaction_date.json': strToU8(JSON.stringify({ rows })) }));

interface IFakeClient {
  generateReport: ReturnType<typeof vi.fn>;
  getReportInfo: ReturnType<typeof vi.fn>;
  downloadReportFile: ReturnType<typeof vi.fn>;
}

let test: ITestFinanceDb;

beforeAll(async () => {
  test = await createTestFinanceDb();
}, 60_000);

afterAll(async () => {
  await test?.close();
});

const operations = () => test.db.select().from(financeOperations);
const documents = () => test.db.select().from(financeDocuments);
const corrections = () => test.db.select().from(financeCorrections);

describe('FinanceImportService — импорт united-netting', () => {
  let client: IFakeClient;
  let report: ReturnType<typeof vi.fn>;
  let findByTelegramUser: ReturnType<typeof vi.fn>;
  let service: FinanceImportService;
  /** Что отдаст «Маркет» на следующий импорт. */
  let file: Buffer | null;

  beforeEach(async () => {
    await test.reset();
    file = zipOf([row()]);

    client = {
      generateReport: vi.fn(async () => 'rep-1'),
      getReportInfo: vi.fn(async () =>
        file ? { status: 'DONE', fileUrl: 'https://file' } : { status: 'DONE' },
      ),
      downloadReportFile: vi.fn(async () => file),
    };
    report = vi.fn(async () => undefined);
    findByTelegramUser = vi.fn(async () => ({
      telegramUserId: '111',
      token: 'secret-token',
      campaign_id: '148655119',
      business_id: '164225008',
    }));

    service = new FinanceImportService(
      { findByTelegramUser } as never,
      { forStore: () => client } as never,
      new FinanceDocumentRepository(test.db),
      new FinanceOperationRepository(test.db),
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      { reconcilePeriod: vi.fn(async () => ({ state: 'skipped' })) } as never,
      { detectPeriod: vi.fn(async () => ({ periodKey: '', anomalies: [] })) } as never,
      new FinanceActServicesRepository(test.db),
    );
  });

  const run = () => service.importPeriod({ telegramUserId: '111', period: SEPTEMBER });

  it('заказывает united-netting в JSON на весь кабинет, даты — границы месяца', async () => {
    await run();
    const [path, body, format] = client.generateReport.mock.calls[0];
    expect(path).toMatch(/united-netting\/generate$/);
    expect(body).toEqual({ businessId: 164225008, dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(format).toBe('JSON');
  });

  it('лимит «1 генерация в минуту» у united-netting — пауза больше минуты и ещё попытка', async () => {
    const sleep = vi.fn(async () => undefined);
    service.sleep = sleep;
    const limit = new YandexRateLimitError('Hit rate limit of 1 points per 1 minute', 420, {});
    client.generateReport.mockRejectedValueOnce(limit).mockResolvedValueOnce('rep-2');

    const result = await run();
    expect(result.status).toBe('imported');
    expect(client.generateReport).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[NETTING_GENERATE_PAUSE_MS]]);
    expect(NETTING_GENERATE_PAUSE_MS).toBeGreaterThan(60_000);
  });

  it('лимит не отпустил за три попытки — ошибка как была; чужие ошибки не пережидаются', async () => {
    const sleep = vi.fn(async () => undefined);
    const limit = new YandexRateLimitError('rate limit', 420, {});
    const always = vi.fn(async () => {
      throw limit;
    });
    await expect(generateWithMinuteLimit(always, sleep)).rejects.toBe(limit);
    expect(always).toHaveBeenCalledTimes(NETTING_GENERATE_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(NETTING_GENERATE_ATTEMPTS - 1);

    sleep.mockClear();
    const other = new Error('Partner API не вернул reportId');
    await expect(
      generateWithMinuteLimit(async () => {
        throw other;
      }, sleep),
    ).rejects.toBe(other);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('первый импорт: версия 1, операции со статьёй и ключом периода', async () => {
    const result = await run();

    expect(result).toMatchObject({ status: 'imported', documentVersion: 1, rows: 1, inserted: 1 });
    expect(await operations()).toHaveLength(1);
    expect((await operations())[0]).toMatchObject({
      article: 'sales',
      amountKopecks: 100000,
      periodKey: `${YM_NETTING_REPORT_TYPE}:2026-09-01:2026-09-30`,
      lastDocumentVersion: 1,
      supersededAt: null,
    });
    expect((await documents())[0]).toMatchObject({ version: 1, status: 'imported', rowCount: 1 });
  });

  it('двойной импорт того же файла: версия 1, ни одной новой операции', async () => {
    await run();
    const second = await run();

    expect(second).toEqual({ status: 'unchanged', period: SEPTEMBER, documentVersion: 1, rows: 1 });
    expect(await operations()).toHaveLength(1);
    expect(await documents()).toHaveLength(1);
    expect(await corrections()).toHaveLength(0);
  });

  it('пересчитанная Маркетом строка: версия 2, старая снята, корректировка «было → стало»', async () => {
    file = zipOf([row(), row({ orderId: 2, transactionSum: 500 })]);
    await run();

    file = zipOf([row(), row({ orderId: 2, transactionSum: 450 })]);
    const result = await run();

    expect(result).toMatchObject({
      status: 'imported',
      documentVersion: 2,
      inserted: 1,
      matched: 1,
      superseded: 1,
      changed: 1,
      removed: 0,
    });
    const old = (await operations()).find((d) => d.amountKopecks === 50000);
    expect(old?.supersededAt).toBeInstanceOf(Date);
    expect(old?.supersededByVersion).toBe(2);
    // Неизменённая строка жива и помечена новой версией, первая версия — в documentId.
    const kept = (await operations()).find((d) => d.amountKopecks === 100000);
    expect(kept).toMatchObject({ supersededAt: null, lastDocumentVersion: 2, documentVersion: 1 });

    expect(await corrections()).toHaveLength(1);
    expect((await corrections())[0]).toMatchObject({
      kind: 'changed',
      documentVersion: 2,
      before: { amountKopecks: 50000, orderId: '2' },
      after: { amountKopecks: 45000, orderId: '2' },
    });
    expect((await corrections())[0].before).not.toHaveProperty('raw');
  });

  it('строка исчезла из новой версии — корректировка removed; новая строка — не корректировка', async () => {
    file = zipOf([row(), row({ orderId: 2 })]);
    await run();

    file = zipOf([row(), row({ orderId: 3 })]);
    const result = await run();

    expect(result).toMatchObject({ superseded: 1, changed: 0, removed: 1, inserted: 1 });
    expect((await corrections()).map((c) => c.kind)).toEqual(['removed']);
    expect((await corrections())[0].after).toBeNull();
  });

  it('строка вернулась в следующей версии — оживает, а не дублируется', async () => {
    file = zipOf([row(), row({ orderId: 2 })]);
    await run();
    file = zipOf([row()]);
    await run();
    file = zipOf([row(), row({ orderId: 2 }), row({ orderId: 4 })]);
    await run();

    const back = (await operations()).filter((d) => d.orderId === '2');
    expect(back).toHaveLength(1);
    expect(back[0].supersededAt).toBeNull();
  });

  it('FAILED у Маркета — ReportGenerationError с reportId, версия не заводится', async () => {
    client.getReportInfo.mockResolvedValue({ status: 'FAILED', subStatus: 'RESOURCE_NOT_FOUND' });

    const error = await run().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReportGenerationError);
    expect((error as ReportGenerationError).details).toMatchObject({
      reportId: 'rep-1',
      status: 'FAILED',
      subStatus: 'RESOURCE_NOT_FOUND',
    });
    expect(await documents()).toHaveLength(0);
    expect(await operations()).toHaveLength(0);
  });

  it('DONE без файла — «данных нет», а не версия с нулём операций', async () => {
    file = null;
    expect(await run()).toEqual({ status: 'empty', period: SEPTEMBER });
    expect(await documents()).toHaveLength(0);
  });

  it('сбой разбора — ни версии, ни операций: транзакция откатилась', async () => {
    file = zipOf([row({ transactionSum: 'мусор' })]);
    await expect(run()).rejects.toThrow(/без суммы/);
    expect(await documents()).toHaveLength(0);
    expect(await operations()).toHaveLength(0);

    // Повтор того же файла — снова честный сбой, а не «unchanged» по хешу.
    await expect(run()).rejects.toThrow(/без суммы/);
    expect(await documents()).toHaveLength(0);
  });

  it('сбой посреди замены версии откатывает всё: v1 жива, v2 нет, ничего не снято', async () => {
    file = zipOf([row(), row({ orderId: 2, transactionSum: 500 })]);
    await run();

    vi.spyOn(FinanceCorrectionRepository.prototype, 'record').mockRejectedValueOnce(
      new Error('база отвалилась'),
    );
    file = zipOf([row(), row({ orderId: 2, transactionSum: 450 })]);
    await expect(run()).rejects.toThrow('база отвалилась');

    expect((await documents()).map((d) => d.version)).toEqual([1]);
    const ops = await operations();
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.supersededAt === null && o.lastDocumentVersion === 1)).toBe(true);
    expect(await corrections()).toHaveLength(0);

    // Повтор после сбоя проходит с нуля.
    expect(await run()).toMatchObject({ status: 'imported', documentVersion: 2, changed: 1 });
  });

  it('нераспознанная статья — один отчёт загрузчика, операция сохранена', async () => {
    file = zipOf([row(), row({ transactionType: 'Новый тип', transactionSource: 'Что-то' })]);
    const result = await run();

    expect(result).toMatchObject({ unknown: 1 });
    expect((await operations()).filter((d) => d.article === 'unknown')).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({ context: YM_UNKNOWN_ARTICLE_CONTEXT });
  });

  it('без магазина — ошибка, а не запрос к Маркету', async () => {
    findByTelegramUser.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(/не подключён магазин/);
    expect(client.generateReport).not.toHaveBeenCalled();
  });
});

describe('FinanceImportProcessor', () => {
  /**
   * Реестр площадок с возможностью `finance` ЯМ поверх подставного
   * `importAndRecord`: процессор ходит через реестр (TASK-127, TASK-162), а
   * проверяется то же — что ушло в импорт финансов.
   */
  function registryOf(importAndRecord: (request: unknown) => unknown) {
    return {
      withCapability: () => ['ym', 'ozon'],
      require: vi.fn((marketplace: string, capability: string) => {
        expect([marketplace, capability]).toEqual(['ym', 'finance']);
        return {
          importFinance: (
            ref: { telegramUserId: string; marketplace: string },
            period: unknown,
          ) => {
            expect(ref.marketplace).toBe('ym');
            return importAndRecord({ telegramUserId: ref.telegramUserId, period });
          },
        };
      }),
    };
  }

  it('payload — продавец и даты, без токена; креды берёт сервис из Mongo', async () => {
    const importAndRecord = vi.fn(async () => ({ status: 'empty' }));
    const processor = new FinanceImportProcessor(
      registryOf(importAndRecord) as never,
      {} as never,
      {} as never,
    );
    const data = { telegramUserId: '111', from: '2026-09-01', to: '2026-09-30' };

    await processor.handle({ data } as never);

    expect(Object.keys(data).sort()).toEqual(['from', 'telegramUserId', 'to']);
    expect(importAndRecord).toHaveBeenCalledWith({
      telegramUserId: '111',
      period: { from: '2026-09-01', to: '2026-09-30' },
    });
  });

  it('упавшая джоба уходит в ErrorReporter со своим context', () => {
    const report = vi.fn(async () => undefined);
    const processor = new FinanceImportProcessor({} as never, {} as never, { report } as never);
    processor.onFailed(
      { data: { telegramUserId: '111', from: '2026-09-01', to: '2026-09-30' } } as never,
      new Error('boom'),
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'finance-import', telegramUserId: '111' }),
    );
  });

  describe('ночной проход', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('в понедельник — три месяца от текущего, сбой одного не мешает следующим', async () => {
      // 12-10-2026 — понедельник, 10:00 МСК.
      vi.setSystemTime(new Date('2026-10-12T07:00:00Z'));
      const importAndRecord = vi.fn(async ({ period }: { period: { from: string } }) => {
        if (period.from === '2026-09-01') throw new Error('FAILED');
        return { status: 'imported' };
      });
      const report = vi.fn(async () => undefined);
      const scheduler = { marketplacesFor: vi.fn(async () => ['ym']), refresh: vi.fn() };
      const processor = new FinanceImportProcessor(
        registryOf(importAndRecord) as never,
        scheduler as never,
        { report } as never,
      );

      const run = await processor.handle({
        data: { telegramUserId: '111', scheduled: true },
      } as never);

      // Текущий первым: сверке прошлого месяца нужен отчёт следующего (TASK-113).
      expect(importAndRecord.mock.calls.map(([r]) => r.period.from)).toEqual([
        '2026-10-01',
        '2026-09-01',
        '2026-08-01',
      ]);
      expect(run).toMatchObject({
        periods: [{ status: 'imported' }, { status: 'failed' }, { status: 'imported' }],
      });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'finance-import', action: 'ym 2026-09-01…2026-09-30' }),
      );
    });

    it('право пропало — ничего не грузит и пересверяет расписание', async () => {
      const importAndRecord = vi.fn();
      const scheduler = { marketplacesFor: vi.fn(async () => []), refresh: vi.fn() };
      const processor = new FinanceImportProcessor(
        registryOf(importAndRecord) as never,
        scheduler as never,
        {} as never,
      );

      const run = await processor.handle({
        data: { telegramUserId: '111', scheduled: true },
      } as never);

      expect(run).toEqual({ skipped: 'not-eligible', periods: [] });
      expect(importAndRecord).not.toHaveBeenCalled();
      expect(scheduler.refresh).toHaveBeenCalled();
    });
  });
});

describe('FinanceImportService.importAndRecord — статус периода и сверка', () => {
  /** Отчёт «Маркета» по dateFrom запроса; null — DONE без файла. */
  let files: Record<string, Buffer | null>;
  let fail: Error | null;
  /** Выкупленные в сентябре заказы и те, что Маркет «знает». */
  let delivered: number[];
  let known: number[];
  let statsFail: Error | null;
  let client: IFakeClient & { listStores: ReturnType<typeof vi.fn> };
  let stats: { iterateOrdersStats: ReturnType<typeof vi.fn> };
  let report: ReturnType<typeof vi.fn>;
  let service: FinanceImportService;
  /** Закрытый сентябрь: «сегодня» — 15-10-2026. */
  const OCTOBER_15 = new Date('2026-10-15T09:00:00Z');
  const NOW_ANY = new Date('2026-10-02T09:00:00Z');

  beforeEach(async () => {
    await test.reset();
    files = {
      '2026-08-01': zipOf([row({ orderId: 50, transactionDate: '16.08.2026 10:00' })]),
      '2026-09-01': zipOf([row()]),
      '2026-10-01': zipOf([row({ orderId: 60, transactionDate: '05.10.2026 10:00' })]),
    };
    fail = null;
    delivered = [1];
    known = [];
    statsFail = null;
    let lastFrom = '';
    client = {
      generateReport: vi.fn(async (_path: string, body: { dateFrom: string }) => {
        if (fail) throw fail;
        lastFrom = body.dateFrom;
        return `rep-${body.dateFrom}`;
      }),
      getReportInfo: vi.fn(async () =>
        files[lastFrom] ? { status: 'DONE', fileUrl: 'https://file' } : { status: 'DONE' },
      ),
      downloadReportFile: vi.fn(async () => files[lastFrom]),
      listStores: vi.fn(async () => [{ campaignId: '148655119', businessId: '164225008' }]),
    };
    stats = {
      iterateOrdersStats: vi.fn(async function* (query: {
        orders?: number[];
        updateFrom?: string;
      }) {
        if (statsFail) throw statsFail;
        const ids = query.orders ? query.orders.filter((id) => known.includes(id)) : delivered;
        if (ids.length) yield ids.map((id) => ({ id }));
      }),
    };
    report = vi.fn(async () => undefined);
    const stores = {
      findByTelegramUser: vi.fn(async () => ({
        business_id: '164225008',
        campaign_id: '148655119',
        token: 't',
      })),
    };
    const clients = { forStore: () => client, forTenant: () => stats };
    const documentsRepo = new FinanceDocumentRepository(test.db);
    const operationsRepo = new FinanceOperationRepository(test.db);
    service = new FinanceImportService(
      stores as never,
      clients as never,
      documentsRepo,
      operationsRepo,
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      new FinanceReconcileService(
        stores as never,
        clients as never,
        documentsRepo,
        operationsRepo,
        new FinanceDiscrepancyRepository(test.db),
        new FinanceActServicesRepository(test.db),
      ),
      { detectPeriod: vi.fn(async () => ({ periodKey: '', anomalies: [] })) } as never,
      new FinanceActServicesRepository(test.db),
    );
  });

  const record = (period = SEPTEMBER, now = OCTOBER_15) =>
    service.importAndRecord({ telegramUserId: '111', period }, now);
  const statusOf = async (from = '2026-09-01') =>
    (await test.db.select().from(financePeriods)).find((p) => p.periodFrom === from);
  const status = () => statusOf();
  /** Соседи сентября загружены — сверка заказов и выплат возможна. */
  const withNeighbours = async () => {
    await record(monthPeriod(2026, 8));
    await record(monthPeriod(2026, 10));
  };
  const discrepancies = () => test.db.select().from(financeDiscrepancies);

  it('чистый импорт закрытого месяца при загруженных соседях — «Проверено»', async () => {
    await withNeighbours();
    await record();
    expect(await status()).toMatchObject({
      status: 'verified',
      lastOutcome: 'imported',
      documentVersion: 1,
      periodKey: `${YM_NETTING_REPORT_TYPE}:2026-09-01:2026-09-30`,
      reconcileState: 'checked',
      discrepancyCount: 0,
      error: null,
    });
    // Заказы — по архиву: выкупленные в сентябре окнами ≤30 дней.
    expect(stats.iterateOrdersStats).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['DELIVERED', 'PARTIALLY_DELIVERED'],
        updateFrom: '2026-09-01',
      }),
    );
  });

  it('без соседних месяцев — не «Проверено», причина видна, Маркет не спрашивается', async () => {
    await record();
    expect(await status()).toMatchObject({
      status: 'preliminary',
      reconcileState: 'unchecked',
      reconcileNote: expect.stringContaining('прошлого и следующего'),
    });
    expect(stats.iterateOrdersStats).not.toHaveBeenCalled();
  });

  describe('сверка акта с отчётом услуг (TASK-158)', () => {
    /** Удержание за размещение по акту 30.09 — строка сентябрьского журнала. */
    const placement = row({
      offerOrServiceName: 'Размещение товарных предложений',
      transactionType: 'Удержание',
      transactionSource: 'Оплата услуг Маркета',
      actId: '26093000015517',
      actDate: '30.09.2026',
      transactionSum: -252,
    });
    const acts = () => new FinanceActServicesRepository(test.db);

    beforeEach(() => {
      files['2026-09-01'] = zipOf([row(), placement]);
    });

    it('итог акта = −Σ журнала — «Проверено», отчёт услуг не перезаказывается', async () => {
      await acts().upsertMany(
        '111',
        [{ actDay: '2026-09-30', totalKopecks: 25200, sheets: {} }],
        NOW_ANY,
      );
      await withNeighbours();
      await record();

      expect(await status()).toMatchObject({ status: 'verified', reconcileState: 'checked' });
      const [act] = await acts()
        .byDays('111', ['2026-09-30'])
        .then((m) => [...m.values()]);
      expect(act.journalMatched).toBe(true);
      const servicesCalls = client.generateReport.mock.calls.filter(([path]) =>
        String(path).includes('marketplace-services'),
      );
      expect(servicesCalls).toHaveLength(0);
    });

    it('акт не сошёлся — «Есть расхождения» и находка с актом и разницей', async () => {
      await acts().upsertMany(
        '111',
        [{ actDay: '2026-09-30', totalKopecks: 25300, sheets: {} }],
        NOW_ANY,
      );
      await withNeighbours();
      await record();

      expect(await status()).toMatchObject({ status: 'discrepancy', discrepancyCount: 1 });
      const [finding] = await discrepancies();
      expect(finding).toMatchObject({
        kind: 'act_mismatch',
        expectedKopecks: 25300,
        actualKopecks: 25200,
        operationCount: 1,
      });
      expect(finding.detail).toContain('Акт 30.09.2026');
      expect(finding.detail).toContain('1,00 ₽');
      // Исход — импорту: этот акт он перезакажет.
      const [act] = await acts()
        .byDays('111', ['2026-09-30'])
        .then((m) => [...m.values()]);
      expect(act.journalMatched).toBe(false);
    });

    it('отчёта услуг за акт нет — не «Проверено», причина называет акт', async () => {
      await withNeighbours();
      await record();

      expect(await status()).toMatchObject({
        status: 'preliminary',
        reconcileState: 'unchecked',
        reconcileNote: expect.stringContaining('30.09.2026'),
      });
    });
  });

  it('незакрытый месяц — «Предварительные данные», сверки нет, запрос к Маркету по сегодня', async () => {
    await record(monthPeriod(2026, 10));
    expect(await statusOf('2026-10-01')).toMatchObject({
      status: 'preliminary',
      periodTo: '2026-10-31',
      reconcileState: 'skipped',
    });
    expect(client.generateReport.mock.calls[0][1]).toMatchObject({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-15',
    });
    expect(stats.iterateOrdersStats).not.toHaveBeenCalled();
  });

  it('выкуплен без начислений — «Есть расхождения», находка со ссылкой; повтор заменяет список', async () => {
    delivered = [1, 2];
    await withNeighbours();
    await record();
    expect(await status()).toMatchObject({ status: 'discrepancy', discrepancyCount: 1 });
    expect(await discrepancies()).toMatchObject([
      { kind: 'delivered_without_accrual', orderId: '2', operationCount: 0 },
    ]);

    await record();
    expect(await discrepancies()).toHaveLength(1);
  });

  it('начисление по заказу, которого Маркет не знает, — находка; знает — чисто', async () => {
    files['2026-09-01'] = zipOf([row(), row({ orderId: 9, transactionSum: 500 })]);
    await withNeighbours();
    await record();
    const [finding] = await discrepancies();
    expect(finding).toMatchObject({
      kind: 'accrual_without_order',
      orderId: '9',
      actualKopecks: 50000,
    });
    expect(finding.operationIds).toHaveLength(1);
    expect(stats.iterateOrdersStats).toHaveBeenCalledWith({ orders: [9] });

    known = [9];
    await service.reconcileAndRecord({ telegramUserId: '111', period: SEPTEMBER }, OCTOBER_15);
    expect(await discrepancies()).toEqual([]);
    expect(await status()).toMatchObject({ status: 'verified', lastOutcome: 'unchanged' });
  });

  it('Σ строк поручения ≠ выплате — находка с ожидаемым и фактическим', async () => {
    files['2026-09-01'] = zipOf([
      row({
        bankOrderId: 501,
        bankOrderDate: '21.09.2026',
        bankSum: 1500,
        paymentStatus: 'Переведён',
      }),
    ]);
    await withNeighbours();
    await record();
    expect(await discrepancies()).toMatchObject([
      {
        kind: 'payment_mismatch',
        bankOrderId: '501',
        expectedKopecks: 150000,
        actualKopecks: 100000,
      },
    ]);
  });

  it('сбой сверки не роняет импорт: журнал записан, статус не «Проверено», алерт', async () => {
    await withNeighbours();
    statsFail = new Error('Маркет недоступен');
    await expect(record()).resolves.toMatchObject({ status: 'imported' });
    expect(await status()).toMatchObject({
      status: 'preliminary',
      reconcileState: 'failed',
      reconcileNote: 'Маркет недоступен',
    });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ context: 'finance:reconcile' }));
  });

  it('отчёта нет — «Предварительные данные»', async () => {
    files['2026-09-01'] = null;
    await record();
    expect(await status()).toMatchObject({ status: 'preliminary', lastOutcome: 'empty' });
  });

  it('Маркет убрал строку — «Есть расхождения», и повтор того же файла их не стирает', async () => {
    files['2026-09-01'] = zipOf([row(), row({ orderId: 2 })]);
    await record();
    files['2026-09-01'] = zipOf([row()]);
    await record();
    expect(await status()).toMatchObject({ status: 'discrepancy', removedCount: 1 });

    await record();
    expect(await status()).toMatchObject({
      status: 'discrepancy',
      lastOutcome: 'unchanged',
      documentVersion: 2,
      removedCount: 1,
    });
  });

  it('строка без статьи — «Есть расхождения» и находка в списке', async () => {
    files['2026-09-01'] = zipOf([
      row({ transactionType: 'Невиданное', transactionSource: 'Новое' }),
    ]);
    await record();
    expect(await status()).toMatchObject({ status: 'discrepancy', unknownCount: 1 });
    expect(await discrepancies()).toMatchObject([{ kind: 'unknown_article' }]);
  });

  it('сбой загрузки пишет ошибку, статус прежний, ошибка пробрасывается', async () => {
    await withNeighbours();
    await record();
    fail = new Error('Маркет недоступен');
    await expect(record()).rejects.toThrow('Маркет недоступен');
    expect(await status()).toMatchObject({
      status: 'verified',
      lastOutcome: 'failed',
      error: 'Маркет недоступен',
    });
  });

  it('повтор не плодит вторую строку статуса', async () => {
    await record();
    await record();
    expect(await test.db.select().from(financePeriods)).toHaveLength(1);
  });
});

describe('pairCorrections', () => {
  const side = (over: Record<string, unknown> = {}) => ({
    operationKey: 'k',
    amountKopecks: 100,
    accruedAt: new Date('2026-09-16T11:05:00Z'),
    article: 'sales',
    transactionType: 'Начисление',
    transactionSource: 'Платёж покупателя',
    orderId: '1',
    sku: 'A1',
    ...over,
  });

  it('одинаковые по смыслу строки разбираются по одной паре на каждую', () => {
    const pairs = pairCorrections(
      [side({ operationKey: 'a' }), side({ operationKey: 'b' })],
      [side({ operationKey: 'c', amountKopecks: 90 })],
    );
    expect(pairs.map((p) => p.kind)).toEqual(['changed', 'removed']);
    expect(pairs[0].after?.operationKey).toBe('c');
  });

  it('другая дата или другой заказ — не пара', () => {
    const pairs = pairCorrections(
      [side()],
      [side({ orderId: '2' }), side({ accruedAt: new Date('2026-09-17T11:05:00Z') })],
    );
    expect(pairs).toEqual([{ kind: 'removed', before: side(), after: null }]);
  });
});

describe('финансовый период и лист журнала', () => {
  it('месяц → границы, февраль високосного года', () => {
    expect(monthPeriod(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(parseMonthArg('09-2026')).toEqual(SEPTEMBER);
    expect(parseMonthArg('13-2026')).toBeNull();
  });

  it('нет листа transaction_date — ошибка с перечнем листов, а не ноль операций', () => {
    expect(() => nettingRowsOf(new Map([['other', { rows: [] }]]))).toThrow(/пришло: other/);
    expect(nettingRowsOf(new Map([['transaction_date', { rows: [] }]]))).toEqual([]);
  });
});

describe('GET /api/finance/corrections', () => {
  it('гвард админки на весь контроллер, ответ — перечисленные поля, свежие сверху', async () => {
    const guards = Reflect.getMetadata('__guards__', FinanceAdminController);
    expect(guards).toContain(AdminJwtGuard);

    await test.reset();
    const service = new FinanceCorrectionRepository(test.db);
    const [doc] = await test.db
      .insert(financeDocuments)
      .values({
        marketplace: 'ym',
        telegramUserId: '111',
        businessId: 'b',
        reportType: 'united-netting',
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        version: 2,
        contentHash: 'h',
      })
      .returning();
    const ctx = {
      marketplace: 'ym' as const,
      telegramUserId: '111',
      businessId: 'b',
      periodKey: 'united-netting:2026-09-01:2026-09-30',
      documentId: doc.id,
      documentVersion: 2,
    };
    const before = {
      operationKey: 'a',
      amountKopecks: 100,
      accruedAt: new Date(),
      article: 'sales',
      transactionType: 'Начисление',
    };
    await service.record(ctx, [{ kind: 'removed', before, after: null }]);
    // Вторая — позже: лента идёт свежими сверху.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.record({ ...ctx, telegramUserId: '222' }, [
      { kind: 'removed', before, after: null },
    ]);

    const controller = new FinanceAdminController(
      service,
      new FinanceDiscrepancyRepository(test.db),
    );
    const all = await controller.list();
    expect(all.total).toBe(2);
    expect(all.items[0].telegramUserId).toBe('222');
    expect(Object.keys(all.items[0]).sort()).toEqual(
      [
        'after',
        'before',
        'createdAt',
        'documentVersion',
        'kind',
        'periodKey',
        'telegramUserId',
      ].sort(),
    );

    const own = await controller.list('111', '1', 'мусор');
    expect(own).toMatchObject({ total: 1, items: [{ telegramUserId: '111', kind: 'removed' }] });
  });
});

describe('GET /api/finance/discrepancies', () => {
  it('находки периода — подпись вида, ссылки и суммы; replacePeriod заменяет, а не копит', async () => {
    await test.reset();
    const repo = new FinanceDiscrepancyRepository(test.db);
    const scope = {
      marketplace: 'ym' as const,
      telegramUserId: '111',
      periodKey: 'united-netting:2026-09-01:2026-09-30',
    };
    const finding = {
      kind: 'payment_mismatch' as const,
      bankOrderId: '501',
      operationIds: ['op-1'],
      operationCount: 1,
      expectedKopecks: 150000,
      actualKopecks: 100000,
      detail: 'Поручение 501',
    };
    await repo.replacePeriod(scope, [finding, { ...finding, bankOrderId: '502' }]);
    await repo.replacePeriod(scope, [finding]);
    await repo.replacePeriod({ ...scope, periodKey: 'united-netting:2026-08-01:2026-08-31' }, [
      finding,
    ]);

    const controller = new FinanceAdminController(new FinanceCorrectionRepository(test.db), repo);
    const page = await controller.discrepancyList('111', scope.periodKey);
    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      telegramUserId: '111',
      periodKey: scope.periodKey,
      kind: 'payment_mismatch',
      kindLabel: 'Сумма операций не равна выплате',
      orderId: null,
      bankOrderId: '501',
      operationIds: ['op-1'],
      operationCount: 1,
      expectedKopecks: 150000,
      actualKopecks: 100000,
      detail: 'Поручение 501',
      createdAt: expect.any(Date),
    });
    expect((await controller.discrepancyList('111')).total).toBe(2);
  });
});
