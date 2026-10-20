import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import { financeOperations } from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import {
  FinanceImportService,
  YM_ACT_BREAKDOWN_CONTEXT,
} from '../../src/modules/finance/finance-import.service';
import { monthPeriod } from '../../src/modules/finance/finance-period';
import { createTestFinanceDb } from '../helpers/test-postgres';

const OCTOBER = monthPeriod(2026, 10);
const NOW = new Date('2026-11-05T10:00:00+03:00');

const netting = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.10.2026 14:05',
  actId: null,
  actDate: null,
  count: 1,
  transactionSum: 1000,
  paymentStatus: 'Будет переведён',
  bankOrderId: null,
  bankOrderDate: null,
  bankSum: null,
  model: 'FBS',
  ...over,
});

/** Сводная строка акта 30.09.2026 — та, что лежит в журнале за октябрь. */
const summary = (over: Record<string, unknown> = {}) =>
  netting({
    orderId: null,
    shopSku: null,
    offerOrServiceName: null,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    transactionDate: '30.09.2026 00:00',
    actId: '26093000015517',
    actDate: '30.09.2026',
    count: null,
    transactionSum: -51852,
    ...over,
  });

/** Удержание за размещение по заказу акта 30.09 — с ним журнал акта = отчёту услуг. */
const placementOp = (over: Record<string, unknown> = {}) =>
  netting({
    offerOrServiceName: 'Размещение товаров на витрине',
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    transactionDate: '30.09.2026 00:00',
    actDate: '30.09.2026',
    transactionSum: -252,
    ...over,
  });

const nettingZip = (rows: Record<string, unknown>[]) =>
  Buffer.from(zipSync({ 'transaction_date.json': strToU8(JSON.stringify({ rows })) }));

const servicesZip = (sheets: Record<string, Record<string, unknown>[]>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(sheets).map(([name, rows]) => [
          `${name}.json`,
          strToU8(JSON.stringify({ rows })),
        ]),
      ),
    ),
  );

const svc = (servicePrice: number) => ({ servicePrice, actDate: '2026-09-30' });
const SEPTEMBER_SERVICES = {
  business_subscription: [svc(16990)],
  pushes: [svc(26703)],
  export_from_warehouse: [svc(1124)],
  order_processing: [svc(1845)],
  order_processing_on_warehouse: [svc(1635)],
  storage_of_returns: [svc(3555)],
  placement: [svc(252)],
};

let test: ITestFinanceDb;

beforeAll(async () => {
  test = await createTestFinanceDb();
}, 60_000);

afterAll(async () => {
  await test?.close();
});

describe('FinanceImportService — расшифровка сводной строки акта (TASK-155)', () => {
  let files: { netting: Buffer; services: Buffer | Error | null };
  let generateReport: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let operationsRepo: FinanceOperationRepository;
  let service: FinanceImportService;

  beforeEach(async () => {
    await test.reset();
    files = {
      netting: nettingZip([netting(), summary()]),
      services: servicesZip(SEPTEMBER_SERVICES),
    };
    generateReport = vi.fn(async (path: string) =>
      path.includes('united-marketplace-services') ? 'services' : 'netting',
    );
    const client = {
      generateReport,
      getReportInfo: vi.fn(async (id: string) => {
        if (id === 'services' && files.services instanceof Error) throw files.services;
        if (id === 'services' && files.services === null) return { status: 'DONE' };
        return { status: 'DONE', fileUrl: `https://file/${id}` };
      }),
      downloadReportFile: vi.fn(async (url: string) =>
        url.endsWith('services') ? files.services : files.netting,
      ),
    };
    report = vi.fn(async () => undefined);
    operationsRepo = new FinanceOperationRepository(test.db);
    service = new FinanceImportService(
      {
        findByTelegramUser: vi.fn(async () => ({
          telegramUserId: '111',
          business_id: '164225008',
        })),
      } as never,
      { forStore: () => client } as never,
      new FinanceDocumentRepository(test.db),
      operationsRepo,
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      { reconcilePeriod: vi.fn(async () => ({ state: 'skipped' })) } as never,
      { detectPeriod: vi.fn(async () => ({ periodKey: '', anomalies: [] })) } as never,
      new FinanceActServicesRepository(test.db),
    );
  });

  const run = () => service.importPeriod({ telegramUserId: '111', period: OCTOBER }, NOW);
  const summaryOp = async () =>
    (await test.db.select().from(financeOperations)).find((op) => op.serviceName === null);
  const servicesCalls = () =>
    generateReport.mock.calls.filter(([path]) => String(path).includes('marketplace-services'));

  it('заказывает отчёт услуг за месяц АКТА и пишет расшифровку полем, статья строки — прежняя', async () => {
    await run();

    expect(servicesCalls()).toHaveLength(1);
    expect(servicesCalls()[0][1]).toEqual({
      businessId: 164225008,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });
    const op = await summaryOp();
    expect(op).toMatchObject({ article: 'other_services', amountKopecks: -5185200 });
    expect(op?.breakdown?.reduce((s, p) => s + p.kopecks, 0)).toBe(-5185200);
    expect(op?.breakdown?.map((p) => p.article)).toContain('subscription');
    expect(report).not.toHaveBeenCalled();
  });

  it('P&L читает части: «прочих услуг» нет, Σ статей — та же', async () => {
    await run();
    const lines = await operationsRepo.liveForPnl(
      '111',
      new Date('2026-09-01T00:00:00+03:00'),
      new Date('2026-11-01T00:00:00+03:00'),
    );
    const byArticle = new Map<string, number>();
    for (const l of lines)
      byArticle.set(l.article, (byArticle.get(l.article) ?? 0) + l.amountKopecks);

    expect(byArticle.get('other_services')).toBeUndefined();
    expect(byArticle.get('subscription')).toBe(-1699000);
    expect(byArticle.get('promotion')).toBe(-2670300);
    expect(byArticle.get('storage')).toBe(-467900);
    expect(byArticle.get('processing')).toBe(-348000);
    expect([...byArticle.values()].reduce((a, b) => a + b, 0)).toBe(100000 - 5185200);
  });

  it('«к получению» раскладывает сводную строку той же развёрткой', async () => {
    await run();
    const rows = await operationsRepo.receivableByArticle('111', new Date('2026-11-06'));
    const map = new Map(rows.map((r) => [r.article, r.kopecks]));
    expect(map.get('other_services')).toBeUndefined();
    expect(map.get('subscription')).toBe(-1699000);
    expect(map.get('sales')).toBe(100000);
  });

  it('отчёт услуг упал — импорт журнала проходит, строка целиком other_services, сбой в ErrorReporter', async () => {
    files.services = new Error('Маркет не ответил');

    const result = await run();

    expect(result.status).toBe('imported');
    expect((await summaryOp())?.breakdown).toBeNull();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: YM_ACT_BREAKDOWN_CONTEXT, telegramUserId: '111' }),
    );
  });

  it('тот же журнал повторно: расшифровка дописывается, если её не было', async () => {
    files.services = new Error('Маркет не ответил');
    await run();
    files.services = servicesZip(SEPTEMBER_SERVICES);

    const result = await run();

    expect(result.status).toBe('unchanged');
    expect((await summaryOp())?.breakdown?.reduce((s, p) => s + p.kopecks, 0)).toBe(-5185200);
  });

  it('расшифровка уже есть — отчёт услуг не заказывается (квота 100/ч)', async () => {
    await run();
    files.netting = nettingZip([netting(), netting({ orderId: 2 }), summary()]);

    await run();

    expect(servicesCalls()).toHaveLength(1);
    expect((await summaryOp())?.breakdown).not.toBeNull();
  });

  it('не сошлось — остаток статьёй unknown и один алерт после фиксации', async () => {
    files.services = servicesZip({ ...SEPTEMBER_SERVICES, pushes: [svc(26000)] });

    await run();

    const op = await summaryOp();
    expect(op?.breakdown?.at(-1)).toEqual({ article: 'unknown', kopecks: -70300, sheet: null });
    expect(op?.breakdown?.reduce((s, p) => s + p.kopecks, 0)).toBe(-5185200);
    const alert = report.mock.calls.find(([arg]) => arg.context === YM_ACT_BREAKDOWN_CONTEXT);
    expect(alert?.[0].error.name).toBe('YmActBreakdownError');
    expect(alert?.[0].error.message).toContain('-703');
  });

  it('две сводные строки одного акта не делятся догадкой — без расшифровки и с алертом', async () => {
    files.netting = nettingZip([summary(), summary({ model: 'FBY', transactionSum: -100 })]);

    await run();

    const ops = await test.db.select().from(financeOperations);
    expect(ops.every((op) => op.breakdown === null)).toBe(true);
    // Отчёт услуг всё равно заказан — один раз, под итог акта для сверки (TASK-158).
    expect(servicesCalls()).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: YM_ACT_BREAKDOWN_CONTEXT }),
    );
  });

  it('upsert без расшифровки (ручная загрузка, сбой услуг) не стирает записанную', async () => {
    await run();
    const op = await summaryOp();
    const { breakdown, id, createdAt, updatedAt, ...row } = op as NonNullable<typeof op>;
    void id;
    void createdAt;
    void updatedAt;

    for (const keepPayment of [false, true]) {
      await operationsRepo.upsertMany([{ ...(row as never), breakdown: undefined }], test.db, {
        keepPayment,
      });
      expect((await summaryOp())?.breakdown).toEqual(breakdown);
    }
  });
  describe('итог акта для сверки с журналом (TASK-158)', () => {
    const repo = () => new FinanceActServicesRepository(test.db);
    const actServices = async () =>
      new Map(
        [...(await repo().byDays('111', ['2026-09-30']))].map(([day, v]) => [day, v.totalKopecks]),
      );

    it('пишет итог акта — Σ ВСЕХ листов, у сводных и по заказу', async () => {
      await run();

      expect(await actServices()).toEqual(new Map([['2026-09-30', 5210400]]));
    });

    it('один отчёт услуг на акт, даже когда нужны и расшифровка, и итог', async () => {
      await run();

      expect(servicesCalls()).toHaveLength(1);
    });

    it('итог есть и сверка его не опровергла — повторный импорт отчёт не заказывает', async () => {
      // Строки акта этого отчёта с итогом не сходятся (-51 852 против 52 104):
      // часть акта лежит в соседнем отчёте, и это не повод тратить квоту.
      await run();
      await repo().markMatched('111', new Map([['2026-09-30', true]]));
      files.netting = nettingZip([netting({ orderId: 2 }), summary()]);

      await run();

      expect(servicesCalls()).toHaveLength(1);
    });

    it('сверка нашла расхождение — следующий импорт перезаказывает и перезаписывает итог', async () => {
      await run();
      await repo().markMatched('111', new Map([['2026-09-30', false]]));
      files.services = servicesZip({ ...SEPTEMBER_SERVICES, placement: [svc(300)] });
      files.netting = nettingZip([netting({ orderId: 2 }), summary()]);

      await run();

      expect(servicesCalls()).toHaveLength(2);
      expect(await actServices()).toEqual(new Map([['2026-09-30', 5215200]]));
      // Новый итог ещё не сверялся.
      expect(
        (await repo().byDays('111', ['2026-09-30'])).get('2026-09-30')?.journalMatched,
      ).toBeNull();
    });

    it('незакрытый акт итога не получает и отчёт под него не заказывается', async () => {
      files.netting = nettingZip([
        placementOp({ actDate: '30.11.2026', transactionDate: '01.11.2026 10:00' }),
      ]);

      await run();

      expect(servicesCalls()).toHaveLength(0);
    });

    it('отчёт услуг упал — итога нет, импорт журнала прошёл', async () => {
      files.services = new Error('Маркет 500');

      const result = await run();

      expect(result.status).toBe('imported');
      expect((await actServices()).size).toBe(0);
    });
  });
});
