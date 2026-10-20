import { strToU8, zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import {
  financeCorrections,
  financeDocuments,
  financeOperations,
  financePeriods,
} from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import {
  FinanceImportBusyError,
  FinanceImportService,
  FinanceNoStoreError,
} from '../../src/modules/finance/finance-import.service';
import { monthPeriod } from '../../src/modules/finance/finance-period';
import { NettingFileError } from '../../src/modules/finance/ym-netting-file';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Ручная загрузка united-netting (TASK-114): тот же журнал, что у импорта
 * Маркета, без дублей при других типах значений, только добавление.
 */

const SEPTEMBER = monthPeriod(2026, 9);
const NOW = new Date('2026-10-17T09:00:00Z');

/** Строка в форме JSON Маркета — числа числами. */
const apiRow = (over: Record<string, unknown> = {}) => ({
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

const HEADER = [
  'Номер заказа',
  'Ваш SKU',
  'Название товара или услуги',
  'Тип транзакции',
  'Источник транзакции',
  'Дата транзакции',
  'Количество',
  'Сумма транзакции, ₽',
];

/** Та же строка, как её дала бы выгрузка кабинета: всё текстом, сумма с запятой. */
const fileCells = (row: ReturnType<typeof apiRow>) => [
  String(row.orderId),
  row.shopSku,
  row.offerOrServiceName,
  row.transactionType,
  row.transactionSource,
  row.transactionDate,
  row.count === null ? '' : String(row.count),
  String(row.transactionSum).replace('.', ','),
];

function xlsxOf(rows: ReturnType<typeof apiRow>[], header = HEADER): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([header, ...rows.map(fileCells)]),
    'Лист1',
  );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const zipOf = (rows: Record<string, unknown>[]) =>
  Buffer.from(zipSync({ 'transaction_date.json': strToU8(JSON.stringify({ rows })) }));

const delivery = (orderId: number, sum: number) =>
  apiRow({
    orderId,
    shopSku: null,
    offerOrServiceName: 'Доставка покупателю',
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    count: null,
    transactionSum: sum,
  });

let test: ITestFinanceDb;

beforeAll(async () => {
  test = await createTestFinanceDb();
}, 60_000);

afterAll(async () => {
  await test?.close();
});

const operations = () => test.db.select().from(financeOperations);
const documents = () => test.db.select().from(financeDocuments);

describe('FinanceImportService.importManual', () => {
  let apiFile: Buffer;
  let report: ReturnType<typeof vi.fn>;
  let reconcilePeriod: ReturnType<typeof vi.fn>;
  let store: Record<string, unknown> | null;
  let service: FinanceImportService;

  const build = (db = test.db) =>
    new FinanceImportService(
      { findByTelegramUser: async () => store } as never,
      {
        forStore: () => ({
          generateReport: async () => 'rep-1',
          getReportInfo: async () => ({ status: 'DONE', fileUrl: 'https://file' }),
          downloadReportFile: async () => apiFile,
        }),
      } as never,
      new FinanceDocumentRepository(test.db),
      new FinanceOperationRepository(test.db),
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      db,
      new FinancePeriodRepository(test.db),
      { reconcilePeriod } as never,
      { detectPeriod: vi.fn(async () => ({ periodKey: '', anomalies: [] })) } as never,
      new FinanceActServicesRepository(test.db),
    );

  beforeEach(async () => {
    await test.reset();
    report = vi.fn(async () => undefined);
    reconcilePeriod = vi.fn(async () => ({ state: 'skipped' }));
    store = { telegramUserId: '111', business_id: '164225008' };
    service = build();
  });

  const importApi = async (rows: Record<string, unknown>[]) => {
    apiFile = zipOf(rows);
    return await service.importPeriod({ telegramUserId: '111', period: SEPTEMBER }, NOW);
  };
  const upload = async (buffer: Buffer, filename = 'отчёт.xlsx') => {
    const { result, followUp } = await service.importManual(
      { telegramUserId: '111', period: SEPTEMBER, buffer, filename },
      NOW,
    );
    await followUp;
    return result;
  };

  it('тот же отчёт после импорта Маркета — 0 новых операций при текстовых значениях', async () => {
    const rows = [apiRow(), apiRow(), delivery(1, -51.5), delivery(2, -1234.56)];
    await importApi(rows);
    const before = await operations();

    const result = await upload(xlsxOf(rows));

    expect(result).toMatchObject({ status: 'imported', rows: 4, inserted: 0, matched: 4 });
    const after = await operations();
    expect(after).toHaveLength(4);
    expect(new Set(after.map((o) => o.operationKey))).toEqual(
      new Set(before.map((o) => o.operationKey)),
    );
  });

  it('оригинал — документ источника manual, следующая версия периода', async () => {
    await importApi([apiRow()]);
    const buffer = xlsxOf([apiRow()]);
    await upload(buffer, 'Отчёт по платежам.xlsx');

    const docs = (await documents()).sort((a, b) => a.version - b.version);
    expect(docs.map((d) => [d.version, d.source])).toEqual([
      [1, 'api'],
      [2, 'manual'],
    ]);
    expect(docs[1]).toMatchObject({
      status: 'imported',
      rowCount: 1,
      originalFilename: 'Отчёт по платежам.xlsx',
      originalContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(Buffer.from(docs[1].original as Buffer).equals(buffer)).toBe(true);
  });

  it('новая строка добавляется, кусок месяца ничего не снимает', async () => {
    await importApi([apiRow(), delivery(1, -51.5), delivery(2, -10)]);

    const result = await upload(xlsxOf([apiRow(), apiRow({ orderId: 5, transactionSum: 700 })]));

    expect(result).toMatchObject({ inserted: 1, matched: 1 });
    const live = (await operations()).filter((o) => o.supersededAt === null);
    expect(live).toHaveLength(4);
    expect(await test.db.select().from(financeCorrections)).toHaveLength(0);
  });

  it('файл без колонок выплаты не стирает выплату, записанную Маркетом', async () => {
    await importApi([
      apiRow({
        paymentStatus: 'Переведён',
        bankOrderId: 'P1',
        bankOrderDate: '20.09.2026',
        bankSum: 1000,
      }),
    ]);

    await upload(xlsxOf([apiRow()]));

    const [op] = await operations();
    expect(op).toMatchObject({
      bankOrderId: 'P1',
      paymentStatus: 'Переведён',
      bankSumKopecks: 100_000,
    });
    expect(op.paidAt).not.toBeNull();
  });

  it('строку, которую Маркет уже пересчитал, старый файл не оживляет', async () => {
    await importApi([apiRow(), delivery(1, -50)]);
    await importApi([apiRow(), delivery(1, -55)]);
    expect((await operations()).filter((o) => o.supersededAt !== null)).toHaveLength(1);

    const result = await upload(xlsxOf([apiRow(), delivery(1, -50)]));

    expect(result).toMatchObject({ inserted: 0, matched: 1, skippedSuperseded: 1 });
    const live = (await operations()).filter((o) => o.supersededAt === null);
    expect(live.map((o) => o.amountKopecks).sort()).toEqual([-5500, 100_000]);
  });

  it('тот же файл второй раз — unchanged, версия не заводится', async () => {
    const buffer = xlsxOf([apiRow()]);
    await upload(buffer);
    expect(await upload(buffer)).toMatchObject({ status: 'unchanged', rows: 1 });
    expect(await documents()).toHaveLength(1);
  });

  it('следом пишется статус месяца, сверка зовётся', async () => {
    await upload(xlsxOf([apiRow()]));
    expect(reconcilePeriod).toHaveBeenCalledWith('111', SEPTEMBER, NOW);
    const [status] = await test.db.select().from(financePeriods);
    expect(status).toMatchObject({ periodFrom: SEPTEMBER.from, lastOutcome: 'imported' });
  });

  it('API-импорт после ручной загрузки снимает строки, которых у Маркета нет', async () => {
    await upload(xlsxOf([apiRow(), apiRow({ orderId: 5 })]));
    const result = await importApi([apiRow()]);
    expect(result).toMatchObject({ status: 'imported', superseded: 1, removed: 1 });
  });

  it('отказы: нераспознанный файл, нет магазина, занятая версия', async () => {
    await expect(upload(xlsxOf([apiRow()], ['Дата транзакции', 'Что-то']))).rejects.toBeInstanceOf(
      NettingFileError,
    );
    expect(await documents()).toHaveLength(0);

    store = null;
    await expect(upload(xlsxOf([apiRow()]))).rejects.toBeInstanceOf(FinanceNoStoreError);

    store = { business_id: '1' };
    const busy = build({
      transaction: async () => {
        throw Object.assign(new Error('duplicate key'), { cause: { code: '23505' } });
      },
    } as never);
    await expect(
      busy.importManual({
        telegramUserId: '111',
        period: SEPTEMBER,
        buffer: xlsxOf([apiRow()]),
        filename: 'a.xlsx',
      }),
    ).rejects.toBeInstanceOf(FinanceImportBusyError);
  });
});
