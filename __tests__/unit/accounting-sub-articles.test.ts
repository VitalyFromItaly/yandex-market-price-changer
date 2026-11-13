import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import { financeOperations } from '../../src/database/postgres/finance.schema';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import {
  backfillAccountingRegistry,
  mergeRegistryColumns,
} from '../../src/modules/accounting/accounting-registry-backfill';
import {
  ACCOUNTING_SUB_ARTICLE_TITLE,
  accountingColumnsOf,
  isAccountingSubArticle,
  OZON_GOODS_KIND_SUB,
  OZON_TYPE_NAME_SUB,
  ozonSubArticle,
  WB_OPER_SUB,
  wbSubArticle,
  YM_REVERSED_SERVICE_SUB,
  YM_TYPE_SOURCE_SUB,
  YM_WITHHELD_SERVICE_SUB,
  ymSubArticle,
} from '../../src/modules/accounting/accounting-sub-articles';
import {
  OZON_RETURN_TYPES,
  OZON_SALE_TYPES,
  ozonAccrualTypeArticle,
} from '../../src/modules/finance/ozon-articles';
import { ozonAccrualToRow, ozonAccrualTypesMap } from '../../src/modules/finance/ozon-journal';
import { WB_KNOWN_OPERS, wbOperArticle } from '../../src/modules/finance/wb-articles';
import { wbRowToOperation } from '../../src/modules/finance/wb-journal';
import { classifyYmRow } from '../../src/modules/finance/ym-articles';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Подстатьи «Финучёта» и колонки реестра (TASK-207). Таблицы подстатей сверяются
 * с классификаторами статей: каждый известный там тип узнан и здесь, и
 * наоборот — подстатья не появляется у типа, который статья считает unknown.
 */

const SERVICE = 'Оплата услуг Маркета';

describe('подстатьи ЯМ', () => {
  it('каждая пара «тип · источник» известна классификатору статей', () => {
    for (const [label, sub] of Object.entries(YM_TYPE_SOURCE_SUB)) {
      const [type, source] = label.split(' · ');
      expect(classifyYmRow({ transactionType: type, transactionSource: source }).article).not.toBe(
        'unknown',
      );
      expect(ymSubArticle(type, source, null)).toBe(sub);
    }
  });

  it('услуги удержания и сторно — по названию; пустое название удержания — сводная строка акта', () => {
    for (const [name, sub] of Object.entries(YM_WITHHELD_SERVICE_SUB)) {
      const row = {
        transactionType: 'Удержание',
        transactionSource: SERVICE,
        offerOrServiceName: name,
      };
      expect(classifyYmRow(row).article).not.toBe('unknown');
      expect(ymSubArticle('Удержание', SERVICE, name)).toBe(sub);
    }
    for (const [name, sub] of Object.entries(YM_REVERSED_SERVICE_SUB)) {
      const row = {
        transactionType: 'Начисление',
        transactionSource: SERVICE,
        offerOrServiceName: name,
      };
      expect(classifyYmRow(row).article).not.toBe('unknown');
      expect(ymSubArticle('Начисление', SERVICE, name)).toBe(sub);
    }
    expect(ymSubArticle('Удержание', SERVICE, '')).toBe('act_summary');
    // Живой импорт 11-2026: сводная, не удержанная из платежей, и её сторно без услуги.
    expect(ymSubArticle('Корректировка удержания', SERVICE, null)).toBe('act_summary');
    expect(ymSubArticle('Начисление', SERVICE, null)).toBe('act_summary');
    expect(ymSubArticle('Корректировка удержания', SERVICE, 'Доставка покупателю')).toBe('unknown');
  });

  it('нормализация как у статей: регистр, пробелы, «ё»', () => {
    expect(ymSubArticle(' начисление ', 'ПЛАТЁЖ  покупателя', null)).toBe('sale');
    expect(ymSubArticle('Удержание', SERVICE, 'приём платежа')).toBe('acquiring');
  });

  it('незнакомое — unknown, не «прочее»; штрафов ЯМ в карте нет', () => {
    expect(ymSubArticle('Удержание', 'Штраф за опоздание', null)).toBe('unknown');
    expect(ymSubArticle('Удержание', SERVICE, 'Новая услуга')).toBe('unknown');
    expect(ymSubArticle('Начисление', SERVICE, 'Новая услуга')).toBe('unknown');
  });

  it('строка журнала ЯМ несёт подстатью; валюты, позиции, даты отчёта и статуса нет — null', () => {
    const raw = {
      orderId: 1,
      shopSku: 'A1',
      offerOrServiceName: 'Товар',
      transactionType: 'Начисление',
      transactionSource: 'Платёж покупателя',
      transactionDate: '16.09.2026 14:05',
      count: 1,
      transactionSum: 1000.1,
    };
    const op = nettingRowToOperation(raw, journalKeys([raw])[0], {
      telegramUserId: '111',
      businessId: 'b1',
      documentId: 'doc-1',
      documentVersion: 1,
      periodKey: 'united-netting:2026-09-01:2026-09-30',
    });
    expect(op).toMatchObject({
      article: 'sales',
      subArticle: 'sale',
      currency: null,
      itemId: null,
      reportedAt: null,
      processingStatus: null,
    });
  });
});

const rub = (amount: string) => ({ amount, currency: 'RUB' });
const OZON_CTX = {
  telegramUserId: '111',
  businessId: 'client-1',
  documentId: 'doc-1',
  documentVersion: 1,
  periodKey: 'ozon-transaction-list:2026-09-01:2026-09-30',
};
const OZON_TYPES = ozonAccrualTypesMap([
  { id: '28', name: 'LastMile', description: 'Последняя миля' },
  { id: '46', name: 'Placements', description: 'Размещение товаров' },
  { id: '47', name: 'Disposal', description: 'Утилизация' },
  { id: '72', name: 'SetOff', description: 'Взаимозачёт' },
]);
const ozonSale = () => ({
  accrual_id: 1,
  date: '2026-09-16',
  unit_number: '0123-0001-1',
  accrued_category: 'POSTING',
  total_amount: rub('1500'),
  posting: {
    products: [
      {
        sku: 900001,
        commission: { sale_amount: rub('2000'), commission: rub('-382') },
        delivery: { services: [{ type_id: 28, accrued: rub('-118') }] },
      },
    ],
  },
});
const ozonFee = (typeId: number, amount = '-120.50') => ({
  accrual_id: 5,
  date: '2026-09-20',
  unit_number: 'contract-77',
  accrued_category: 'NON_ITEM',
  total_amount: rub(amount),
  non_item_fee: { type_id: typeId, accrued: rub(amount) },
});

describe('подстатьи Ozon', () => {
  it('каждое имя типа известно классификатору статей', () => {
    for (const name of Object.keys(OZON_TYPE_NAME_SUB)) {
      expect(ozonAccrualTypeArticle(name)).not.toBe('unknown');
    }
  });

  it('типы строк с товаром — ровно продажи и возвраты классификатора статей', () => {
    expect(new Set(Object.keys(OZON_GOODS_KIND_SUB))).toEqual(
      new Set([...OZON_SALE_TYPES, ...OZON_RETURN_TYPES]),
    );
  });

  it('отправление — продажа/возврат; сбор — по имени крупнейшей части; утилизация отдельно от хранения', () => {
    expect(ozonAccrualToRow(ozonSale(), OZON_CTX, OZON_TYPES).subArticle).toBe('sale');
    expect(ozonAccrualToRow(ozonFee(46), OZON_CTX, OZON_TYPES)).toMatchObject({
      article: 'storage',
      subArticle: 'storage',
    });
    expect(ozonAccrualToRow(ozonFee(47), OZON_CTX, OZON_TYPES)).toMatchObject({
      article: 'storage',
      subArticle: 'disposal',
    });
    expect(ozonAccrualToRow(ozonFee(72), OZON_CTX, OZON_TYPES).subArticle).toBe('unknown');
  });

  it('валюта — из явного поля total_amount.currency', () => {
    expect(ozonAccrualToRow(ozonSale(), OZON_CTX, OZON_TYPES).currency).toBe('RUB');
    const noCurrency = { ...ozonFee(46), total_amount: { amount: '-120.50' } };
    expect(ozonAccrualToRow(noCurrency, OZON_CTX, OZON_TYPES).currency).toBeNull();
  });

  it('старая форма /v3 (items[]) — по типу операции', () => {
    expect(ozonSubArticle('OperationAgentDeliveredToCustomer', null)).toBe('sale');
    expect(ozonSubArticle('ClientReturnAgentOperation', null)).toBe('return');
    expect(ozonSubArticle('MarketplaceServiceItemDirectFlowLogistic', null)).toBe('unknown');
  });

  it('без частей сбор не узнать — unknown', () => {
    expect(ozonSubArticle('NON_ITEM', null)).toBe('unknown');
    expect(ozonSubArticle('NON_ITEM', [{ kopecks: -100, sheet: 'Disposal' }])).toBe('disposal');
  });
});

const WB_CTX = {
  telegramUserId: '111',
  businessId: 'sid-1',
  documentId: '00000000-0000-0000-0000-000000000001',
  documentVersion: 1,
  periodKey: 'wb-realization-report:2026-09-01:2026-09-30',
};
const wbRow = (over: Record<string, unknown> = {}) => ({
  rrd_id: 1001,
  realizationreport_id: 555,
  rr_dt: '2026-09-16',
  supplier_oper_name: 'Продажа',
  doc_type_name: 'Продажа',
  sa_name: 'VC-1',
  srid: 'srid-1',
  quantity: 1,
  retail_price_withdisc_rub: 2000,
  acquiring_fee: 30,
  ppvz_for_pay: 1600,
  ...over,
});

describe('подстатьи WB', () => {
  it('ключи таблицы — ровно известные типы строк WB', () => {
    expect(new Set(Object.keys(WB_OPER_SUB))).toEqual(new Set(WB_KNOWN_OPERS));
  });

  it('штраф и удержание — разные подстатьи; незнакомый тип — unknown, как у статьи', () => {
    expect(wbSubArticle('Штраф')).toBe('penalty');
    expect(wbSubArticle('Удержание')).toBe('withholding');
    expect(wbSubArticle('Новый тип')).toBe('unknown');
    expect(wbOperArticle('Новый тип')).toBe('unknown');
  });

  it('строка отчёта несёт подстатью; currency_name — только если есть', () => {
    expect(wbRowToOperation(wbRow(), WB_CTX)).toMatchObject({ subArticle: 'sale', currency: null });
    expect(wbRowToOperation(wbRow({ currency_name: 'rub' }), WB_CTX).currency).toBe('RUB');
  });
});

describe('справочник подстатей', () => {
  it('у каждой подстатьи есть подпись, unknown — полноправная', () => {
    for (const [key, title] of Object.entries(ACCOUNTING_SUB_ARTICLE_TITLE)) {
      expect(isAccountingSubArticle(key)).toBe(true);
      expect(title).not.toBe('');
    }
    expect(isAccountingSubArticle('unknown')).toBe(true);
    expect(isAccountingSubArticle('прочее')).toBe(false);
  });

  it('accountingColumnsOf не выдумывает: позиции, даты отчёта и статуса нет ни у кого', () => {
    for (const marketplace of ['ym', 'ozon', 'wb'] as const) {
      const columns = accountingColumnsOf({ marketplace, transactionType: 'x', raw: {} });
      expect(columns).toEqual({
        subArticle: 'unknown',
        currency: null,
        itemId: null,
        reportedAt: null,
        processingStatus: null,
      });
    }
  });

  it('бэкфилл не ухудшает записанное: unknown и пустое не стирают значение', () => {
    const stored = {
      subArticle: 'disposal' as const,
      currency: 'RUB',
      itemId: null,
      reportedAt: null,
      processingStatus: null,
    };
    const computed = accountingColumnsOf({
      marketplace: 'ozon',
      transactionType: 'NON_ITEM',
      raw: {},
    });
    expect(mergeRegistryColumns(stored, computed)).toEqual(stored);
  });
});

describe('реестр в Postgres: upsert и бэкфилл', () => {
  const PERIOD = 'united-netting:2026-09-01:2026-09-30';
  const ymRaw = (over: Record<string, unknown> = {}) => ({
    orderId: 1,
    shopSku: 'A1',
    offerOrServiceName: 'Товар',
    transactionType: 'Начисление',
    transactionSource: 'Платёж покупателя',
    transactionDate: '16.09.2026 14:05',
    count: 1,
    transactionSum: 1000.1,
    ...over,
  });

  let test: ITestFinanceDb;
  let operations: FinanceOperationRepository;
  let documents: FinanceDocumentRepository;

  beforeAll(async () => {
    test = await createTestFinanceDb();
    operations = new FinanceOperationRepository(test.db);
    documents = new FinanceDocumentRepository(test.db);
  }, 60_000);

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.reset();
  });

  const writeYm = async (rows: Record<string, unknown>[]) => {
    const { document } = await documents.registerVersion({
      marketplace: 'ym',
      telegramUserId: '111',
      businessId: 'b1',
      reportType: 'united-netting',
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      buffer: Buffer.from(JSON.stringify(rows)),
      filename: 'netting.zip',
      contentType: 'application/zip',
    });
    const keys = journalKeys(rows);
    const ops = rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: '111',
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: PERIOD,
      }),
    );
    await operations.upsertMany(ops);
    return ops;
  };

  const stored = () =>
    test.db
      .select({ sub: financeOperations.subArticle, amount: financeOperations.amountKopecks })
      .from(financeOperations);

  it('повторный upsert без колонок не стирает записанные', async () => {
    const [op] = await writeYm([ymRaw()]);
    await operations.upsertMany([{ ...op, subArticle: null, currency: null }]);
    expect(await stored()).toEqual([{ sub: 'sale', amount: 100010 }]);
  });

  it('строки до миграции: dry run ничего не пишет, --apply дозаполняет, второй --apply — ноль изменений', async () => {
    await writeYm([
      ymRaw(),
      ymRaw({
        transactionType: 'Удержание',
        transactionSource: SERVICE,
        offerOrServiceName: '',
        transactionSum: -50,
      }),
      ymRaw({ transactionType: 'Удержание', transactionSource: 'Неведомое', transactionSum: -7 }),
    ]);
    // Как строки, записанные до TASK-207: колонок нет.
    await test.db.update(financeOperations).set({ subArticle: null });

    const dry = await backfillAccountingRegistry(test.db, { apply: false });
    expect(dry).toMatchObject({ scanned: 3, changed: 3 });
    expect(dry.distribution.ym).toEqual({ sale: 1, act_summary: 1, unknown: 1 });
    expect((await stored()).every((row) => row.sub === null)).toBe(true);

    const first = await backfillAccountingRegistry(test.db, { apply: true });
    expect(first.changed).toBe(3);
    const subs = (await stored()).map((row) => row.sub).sort();
    expect(subs).toEqual(['act_summary', 'sale', 'unknown']);

    const second = await backfillAccountingRegistry(test.db, { apply: true });
    expect(second).toMatchObject({ scanned: 3, changed: 0 });
  });

  it('фильтр по продавцу и площадке', async () => {
    await writeYm([ymRaw()]);
    await test.db.update(financeOperations).set({ subArticle: null });
    const other = await backfillAccountingRegistry(test.db, { apply: true, telegramUserId: '222' });
    expect(other).toMatchObject({ scanned: 0, changed: 0 });
    const ozon = await backfillAccountingRegistry(test.db, { apply: true, marketplace: 'ozon' });
    expect(ozon.scanned).toBe(0);
    const [row] = await test.db
      .select({ sub: financeOperations.subArticle })
      .from(financeOperations)
      .where(eq(financeOperations.telegramUserId, '111'));
    expect(row.sub).toBeNull();
  });
});
