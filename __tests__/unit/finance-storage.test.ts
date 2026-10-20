import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import {
  FINANCE_ORIGINAL_MAX_BYTES,
  financeDocuments,
  financeOperations,
} from '../../src/database/postgres/finance.schema';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Хранилище финансового журнала на Postgres (TASK-156). Под `npm test` — PGlite,
 * в CI ещё раз на настоящем сервере (TEST_POSTGRES_URL): миграции те же, что в
 * проде, поэтому уникальные индексы и типы колонок проверяются по-настоящему.
 */

const PERIOD = 'united-netting:2026-09-01:2026-09-30';

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Товар',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 1,
  transactionSum: 1000.1,
  paymentStatus: 'Будет переведён',
  bankOrderId: null,
  bankOrderDate: null,
  bankSum: null,
  ...over,
});

let test: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let corrections: FinanceCorrectionRepository;

beforeAll(async () => {
  test = await createTestFinanceDb();
  operations = new FinanceOperationRepository(test.db);
  documents = new FinanceDocumentRepository(test.db);
  corrections = new FinanceCorrectionRepository(test.db);
}, 60_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await test.reset();
});

const docInput = (buffer: Buffer, telegramUserId = '111') => ({
  marketplace: 'ym' as const,
  telegramUserId,
  businessId: 'b1',
  reportType: 'united-netting',
  periodFrom: '2026-09-01',
  periodTo: '2026-09-30',
  buffer,
  filename: 'netting.zip',
  contentType: 'application/zip',
});

/** Версия документа — операции ссылаются на неё внешним ключом. */
const version = async (content: string, telegramUserId = '111') =>
  (await documents.registerVersion(docInput(Buffer.from(content), telegramUserId))).document;

const opsOf = (
  rows: Record<string, unknown>[],
  doc: { id: string; version: number },
  telegramUserId = '111',
) => {
  const keys = journalKeys(rows);
  return rows.map((r, i) =>
    nettingRowToOperation(r, keys[i], {
      telegramUserId,
      businessId: 'b1',
      documentId: doc.id,
      documentVersion: doc.version,
      periodKey: PERIOD,
    }),
  );
};

const allOperations = () => test.db.select().from(financeOperations);

describe('схема finance_* (миграции drizzle)', () => {
  it('уникальный индекс (marketplace, telegram_user_id, operation_key)', async () => {
    const found = await test.db.execute(
      sql`select indexdef from pg_indexes where indexname = 'finance_operations_key_uq'`,
    );
    const def = String((found.rows[0] as { indexdef: string }).indexdef);
    expect(def).toContain('UNIQUE');
    expect(def).toContain('(marketplace, telegram_user_id, operation_key)');
  });

  it('копейки — bigint, raw — jsonb', async () => {
    const found = await test.db.execute(
      sql`select column_name, data_type from information_schema.columns
          where table_name = 'finance_operations'
            and column_name in ('amount_kopecks', 'bank_sum_kopecks', 'raw')
          order by column_name`,
    );
    expect(found.rows).toEqual([
      { column_name: 'amount_kopecks', data_type: 'bigint' },
      { column_name: 'bank_sum_kopecks', data_type: 'bigint' },
      { column_name: 'raw', data_type: 'jsonb' },
    ]);
  });
});

describe('FinanceOperationRepository', () => {
  it('двойной upsert одной операции даёт одну запись', async () => {
    const doc = await version('zip-1');
    const first = await operations.upsertMany(opsOf([row()], doc));
    const second = await operations.upsertMany(opsOf([row()], doc));

    expect(first).toEqual({ inserted: 1, matched: 0 });
    expect(second).toEqual({ inserted: 0, matched: 1 });
    const all = await allOperations();
    expect(all).toHaveLength(1);
    expect(all[0].amountKopecks).toBe(100010);
  });

  it('две одинаковые строки отчёта — две операции, и повтор их не удваивает', async () => {
    const doc = await version('zip-1');
    await operations.upsertMany(opsOf([row(), row()], doc));
    await operations.upsertMany(opsOf([row(), row()], doc));
    expect(await allOperations()).toHaveLength(2);
  });

  it('повтор дописывает выплату, но не перетирает неизменяемое', async () => {
    const v1 = await version('zip-1');
    const v2 = await version('zip-2');
    await operations.upsertMany(opsOf([row()], v1));
    const paid = row({
      paymentStatus: 'Переведён',
      bankOrderId: 777,
      bankOrderDate: '20.09.2026',
      bankSum: 1000.1,
    });
    await operations.upsertMany(opsOf([paid], v2));

    const [op] = await allOperations();
    expect(op).toMatchObject({
      paymentStatus: 'Переведён',
      bankOrderId: '777',
      bankSumKopecks: 100010,
      documentId: v1.id,
      documentVersion: 1,
      lastDocumentId: v2.id,
      lastDocumentVersion: 2,
    });
    expect(op.paidAt?.toISOString()).toBe('2026-09-19T21:00:00.000Z');
    expect(op.raw.paymentStatus).toBe('Будет переведён');
  });

  it('у другого продавца тот же ключ — своя запись', async () => {
    await operations.upsertMany(opsOf([row()], await version('zip-1', '111'), '111'));
    await operations.upsertMany(opsOf([row()], await version('zip-1', '222'), '222'));
    expect(await allOperations()).toHaveLength(2);
  });

  it('снятые новой версией: findStale → markSuperseded, вернувшаяся строка оживает', async () => {
    const v1 = await version('zip-1');
    await operations.upsertMany(opsOf([row(), row({ orderId: 2 })], v1));
    const v2 = await version('zip-2');
    await operations.upsertMany(opsOf([row()], v2));

    const stale = await operations.findStale('111', PERIOD, v2.id);
    expect(stale.map((s) => s.orderId)).toEqual(['2']);
    expect(stale[0]).not.toHaveProperty('raw');

    expect(await operations.markSuperseded('111', ['nope', stale[0].operationKey], 2)).toBe(1);
    expect(await operations.keysOfPeriod('111', PERIOD)).toHaveProperty('size', 1);

    const v3 = await version('zip-3');
    await operations.upsertMany(opsOf([row(), row({ orderId: 2 })], v3));
    const back = (await allOperations()).find((o) => o.orderId === '2');
    expect(back).toMatchObject({ supersededAt: null, supersededByVersion: null });
  });

  it('пачка больше чанка пишется целиком', async () => {
    const doc = await version('zip-1');
    const rows = Array.from({ length: 2500 }, (_, i) => row({ orderId: i + 1 }));
    expect(await operations.upsertMany(opsOf(rows, doc))).toEqual({ inserted: 2500, matched: 0 });
  });

  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    'параллельный upsert одной операции с двух соединений — одна строка (только живой Postgres)',
    async () => {
      const doc = await version('zip-1');
      const ops = opsOf([row()], doc);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => operations.upsertMany(ops)),
      );

      expect(await allOperations()).toHaveLength(1);
      expect(results.reduce((sum, r) => sum + r.inserted, 0)).toBe(1);
    },
  );
});

describe('FinanceDocumentRepository', () => {
  it('тот же файл дважды — одна версия, оригинал сохранён', async () => {
    const first = await documents.registerVersion(docInput(Buffer.from('zip-1')));
    const again = await documents.registerVersion(docInput(Buffer.from('zip-1')));

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.document.id).toBe(first.document.id);
    expect(first.document).toMatchObject({ version: 1, status: 'pending' });
    expect(first.document).not.toHaveProperty('original');
    expect((await documents.original('111', first.document.id))?.toString()).toBe('zip-1');
  });

  it('изменённый файл — версия 2', async () => {
    await documents.registerVersion(docInput(Buffer.from('zip-1')));
    const next = await documents.registerVersion(docInput(Buffer.from('zip-2')));

    expect(next.created).toBe(true);
    expect(next.document.version).toBe(2);
  });

  it('оригинал больше потолка не пишется, но версия заводится', async () => {
    const big = Buffer.alloc(FINANCE_ORIGINAL_MAX_BYTES + 1);
    const { document } = await documents.registerVersion(docInput(big));

    expect(document).toMatchObject({ originalTooLarge: true, version: 1 });
    expect(await documents.original('111', document.id)).toBeNull();
  });

  it('статус загрузки', async () => {
    const { document } = await documents.registerVersion(docInput(Buffer.from('zip-1')));
    await documents.markImported('111', document.id, 21663);
    expect(await documents.latest(docInput(Buffer.from('')))).toMatchObject({
      status: 'imported',
      rowCount: 21663,
    });
  });

  it('гонка номера версии упирается в уникальный индекс', async () => {
    await documents.registerVersion(docInput(Buffer.from('zip-1')));
    await expect(
      test.db.insert(financeDocuments).values({
        ...docInput(Buffer.from('x')),
        version: 1,
        contentHash: 'other',
      }),
    ).rejects.toThrow();
  });
});

describe('транзакция замены версии', () => {
  it('сбой посреди транзакции откатывает всё: ни версии, ни операций, ни корректировок', async () => {
    const v1 = await version('zip-1');
    await operations.upsertMany(opsOf([row()], v1));

    await expect(
      test.db.transaction(async (tx) => {
        const { document } = await documents.registerVersion(docInput(Buffer.from('zip-2')), tx);
        await operations.upsertMany(opsOf([row({ orderId: 2 })], document), tx);
        await corrections.record(
          {
            marketplace: 'ym',
            telegramUserId: '111',
            businessId: 'b1',
            periodKey: PERIOD,
            documentId: document.id,
            documentVersion: document.version,
          },
          [
            {
              kind: 'removed',
              before: {
                operationKey: 'k',
                amountKopecks: 1,
                accruedAt: new Date(),
                article: 'sales',
                transactionType: 'Начисление',
              },
              after: null,
            },
          ],
          tx,
        );
        throw new Error('сбой разбора');
      }),
    ).rejects.toThrow('сбой разбора');

    expect(await test.db.select().from(financeDocuments)).toHaveLength(1);
    expect(await allOperations()).toHaveLength(1);
    expect((await corrections.list({})).total).toBe(0);
    const [op] = await test.db
      .select()
      .from(financeOperations)
      .where(eq(financeOperations.lastDocumentId, v1.id));
    expect(op).toBeDefined();
  });
});

describe('FinanceCorrectionRepository', () => {
  it('лента продавца свежими сверху, потолок страницы', async () => {
    const doc = await version('zip-1');
    const ctx = {
      marketplace: 'ym' as const,
      telegramUserId: '111',
      businessId: 'b1',
      periodKey: PERIOD,
      documentId: doc.id,
      documentVersion: 1,
    };
    const before = {
      operationKey: 'a',
      amountKopecks: 100,
      accruedAt: new Date('2026-09-16T11:05:00Z'),
      article: 'sales',
      transactionType: 'Начисление',
    };
    await corrections.record(ctx, [{ kind: 'removed', before, after: null }]);
    await corrections.record({ ...ctx, telegramUserId: '222' }, [
      { kind: 'changed', before, after: { ...before, amountKopecks: 90 } },
    ]);

    const all = await corrections.list({ limit: 1000 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(2);
    const own = await corrections.list({ telegramUserId: '222' });
    expect(own.items[0]).toMatchObject({ kind: 'changed', after: { amountKopecks: 90 } });
  });
});
