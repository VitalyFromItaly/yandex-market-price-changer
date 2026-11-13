import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ITestFinanceDb } from '../helpers/test-postgres';

import { financeDocuments, financeOperations } from '../../src/database/postgres/finance.schema';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { isManualArticle } from '../../src/modules/accounting/manual-operation.domain';
import { FINANCE_ARTICLE_META } from '../../src/modules/finance/finance-articles';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { FinanceImportService } from '../../src/modules/finance/finance-import.service';
import {
  WB_PROMOTION_REPORT_TYPE,
  financePeriodKey,
  monthPeriod,
} from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { PNL_SECTION } from '../../src/modules/finance/pnl';
import { TAX_BASE_ARTICLES } from '../../src/modules/finance/tax';
import {
  WB_PROMOTION_COLUMNS,
  parseWbPromotionFile,
  wbPromotionHeaderIndex,
} from '../../src/modules/finance/wb-promotion-file';
import { NettingFileError, normalizeHeader } from '../../src/modules/finance/ym-netting-file';
import { WbFinanceService } from '../../src/modules/wb/wb-finance.service';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Отчёт WB «Продвижение» файлом (TASK-209): справочная реклама в том же
 * журнале, без дублей при повторе и без влияния на P&L. Образца файла кабинета
 * нет (решение accounting_upload_no_sample) — файлы собираются здесь по
 * угаданным заголовкам.
 */

const SELLER = '111';
const SEPT = monthPeriod(2026, 9);
const NOW = new Date('2026-10-18T07:00:00Z');

const HEADER = [
  'ID кампании',
  'Название кампании',
  'Тип кампании',
  'Дата списания',
  'Номер документа',
  'Сумма списания, ₽',
  'Источник списания',
];

type TCells = (string | number)[];
const spend = (id: number, date: string, sum: string, doc = `D-${id}`): TCells => [
  String(id),
  `Кампания ${id}`,
  'Аукцион',
  date,
  doc,
  sum,
  'Счёт',
];

function xlsxOf(rows: TCells[], header: string[] = HEADER, top: TCells[] = []): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([...top, header, ...rows]), 'Затраты');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const csvOf = (rows: TCells[], header: string[] = HEADER) =>
  Buffer.from(
    '﻿' + [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\r\n'),
    'utf-8',
  );

describe('parseWbPromotionFile', () => {
  it('один заголовок ведёт ровно в одно поле', () => {
    const seen = new Map<string, string>();
    for (const [field, column] of Object.entries(WB_PROMOTION_COLUMNS)) {
      for (const synonym of new Set([field, ...column.synonyms].map(normalizeHeader))) {
        expect(seen.get(synonym) ?? field, synonym).toBe(field);
        seen.set(synonym, field);
      }
    }
    expect(wbPromotionHeaderIndex().get(normalizeHeader('Сумма, руб.'))).toBe('updSum');
  });

  it('xlsx: шапка над таблицей, подвал «Итого», сумма с запятой', () => {
    const file = xlsxOf(
      [
        spend(1, '05.09.2026 10:15', '1 500,50'),
        spend(2, '06.09.2026', '200'),
        ['Итого', '', '', '', '', '1700,50', ''],
      ],
      HEADER,
      [['История затрат'], []],
    );
    const { rows, headerRow } = parseWbPromotionFile(file, 'promo.xlsx');
    expect(headerRow).toBe(3);
    expect(rows).toEqual([
      expect.objectContaining({ advertId: '1', updTime: '05.09.2026 10:15', updSum: 1500.5 }),
      expect.objectContaining({ advertId: '2', updTime: '06.09.2026 00:00', updSum: 200 }),
    ]);
  });

  it('csv UTF-8 с BOM и «;»', () => {
    const { rows } = parseWbPromotionFile(csvOf([spend(7, '2026-09-10 08:00', '99,9')]), 'p.csv');
    expect(rows).toEqual([
      expect.objectContaining({ advertId: '7', updTime: '10.09.2026 08:00', updSum: 99.9 }),
    ]);
  });

  it('отказы: чужой отчёт, нет колонок, битая сумма, пусто', () => {
    const realization = xlsxOf(
      [['1', '555', 'Продажа']],
      ['rrd_id', 'Номер отчёта', 'Обоснование для оплаты'],
    );
    expect(() => parseWbPromotionFile(realization, 'r.xlsx')).toThrow(
      expect.objectContaining({ kind: 'wrong-report' }),
    );
    expect(() => parseWbPromotionFile(xlsxOf([['x']], ['Что-то']), 'x.xlsx')).toThrow(
      expect.objectContaining({ kind: 'unrecognized' }),
    );
    expect(() => parseWbPromotionFile(xlsxOf([spend(1, '05.09.2026', 'много')]), 'b.xlsx')).toThrow(
      expect.objectContaining({ kind: 'bad-row', details: expect.objectContaining({ row: 2 }) }),
    );
    expect(() => parseWbPromotionFile(xlsxOf([]), 'e.xlsx')).toThrow(NettingFileError);
  });
});

describe('справочная статья promotion_report', () => {
  it('вне прибыли, налога и ручного ввода', () => {
    expect(FINANCE_ARTICLE_META.promotion_report.group).toBe('reference');
    expect(PNL_SECTION.promotion_report).toBe('reference');
    expect(TAX_BASE_ARTICLES.promotion_report).toBe(false);
    expect(isManualArticle('promotion_report')).toBe(false);
  });
});

let test: ITestFinanceDb;

beforeAll(async () => {
  test = await createTestFinanceDb();
}, 60_000);

afterAll(async () => {
  await test?.close();
});

describe('WbFinanceService.importPromotionFile → finance_operations', () => {
  let connection: Record<string, unknown> | null;
  let wbRows: Record<string, unknown>[];
  let operationsRepo: FinanceOperationRepository;
  let wb: WbFinanceService;
  let finance: FinanceService;

  beforeEach(async () => {
    await test.reset();
    connection = { accounts: [{ id: 'sid-1', name: 'Магазин' }] };
    // Строка отчёта реализации с рекламой внутри удержания — как её даёт API.
    wbRows = [
      {
        rrd_id: 10,
        realizationreport_id: 555,
        rr_dt: '2026-09-16',
        create_dt: '2026-09-22',
        supplier_oper_name: 'Удержание',
        doc_type_name: '',
        bonus_type_name: 'Оказание услуг «ВБ.Продвижение»',
        quantity: 0,
        retail_price_withdisc_rub: 0,
        acquiring_fee: 0,
        ppvz_for_pay: 0,
        delivery_rub: 0,
        storage_fee: 0,
        penalty: 0,
        deduction: 1700.5,
        acceptance: 0,
        additional_payment: 0,
      },
    ];
    operationsRepo = new FinanceOperationRepository(test.db);
    const report = vi.fn(async () => undefined);
    const imports = new FinanceImportService(
      {} as never,
      {} as never,
      new FinanceDocumentRepository(test.db),
      operationsRepo,
      new FinanceCorrectionRepository(test.db),
      { report } as never,
      test.db,
      new FinancePeriodRepository(test.db),
      { reconcilePeriod: vi.fn(() => Promise.reject(new Error('не для файла'))) } as never,
      { detectPeriod: vi.fn(() => Promise.reject(new Error('не для файла'))) } as never,
      new FinanceActServicesRepository(test.db),
    );
    wb = new WbFinanceService(
      { forToken: () => ({ listRealizationReport: async () => wbRows }) } as never,
      {
        credentialsOf: async () => ({ token: 'SECRET' }),
        findOne: async () => connection,
      } as never,
      { findByMarketplaceSkus: async () => [] } as never,
      imports,
      { report } as never,
    );
    finance = new FinanceService(
      operationsRepo,
      new FinancePeriodRepository(test.db),
      new FinanceTaxService(new FinanceTaxSettingsRepository(test.db)),
      new FinanceExpensesService(new FinanceExpenseRepository(test.db)),
      { findByTelegramUser: async () => null } as never,
      { findBySkus: async () => new Map() } as never,
      { findForSkus: async () => new Map() } as never,
      { build: vi.fn() } as never,
      { report } as never,
    );
  });

  const upload = (buffer: Buffer, filename = 'promo.xlsx') =>
    wb.importPromotionFile(SELLER, SEPT, { buffer, filename }, NOW);
  const wbOps = () =>
    test.db.select().from(financeOperations).where(eq(financeOperations.marketplace, 'wb'));
  const promoOps = async () =>
    (await wbOps()).filter((op) => op.article === 'promotion_report' && !op.supersededAt);
  const sum = (ops: { amountKopecks: number }[]) => ops.reduce((s, op) => s + op.amountKopecks, 0);

  const FILE = xlsxOf([
    spend(1, '05.09.2026 10:15', '1500,50'),
    spend(2, '06.09.2026 11:00', '200'),
  ]);

  it('справочные строки рекламы WB с подстатьёй и оригиналом; тот же файл ещё раз — 0 новых', async () => {
    expect(await upload(FILE)).toMatchObject({
      status: 'imported',
      rows: 2,
      inserted: 2,
      matched: 0,
    });
    const ops = await promoOps();
    expect(ops).toHaveLength(2);
    expect(sum(ops)).toBe(-170050);
    expect(ops[0]).toMatchObject({
      marketplace: 'wb',
      businessId: 'sid-1',
      direction: 'expense',
      subArticle: 'advertising',
      periodKey: financePeriodKey(WB_PROMOTION_REPORT_TYPE, SEPT),
    });
    expect(ops.map((op) => op.serviceName).sort()).toEqual(['Кампания 1', 'Кампания 2']);

    expect(await upload(FILE)).toMatchObject({ status: 'unchanged', rows: 2 });
    expect(await promoOps()).toHaveLength(2);
    expect(sum(await promoOps())).toBe(-170050);
    const docs = await test.db.select().from(financeDocuments);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      marketplace: 'wb',
      reportType: 'wb-promotion',
      source: 'manual',
    });
  });

  it('другой файл с теми же списаниями (csv) — новые только новые, суммы не удвоились', async () => {
    await upload(FILE);
    const csv = csvOf([
      spend(1, '05.09.2026 10:15', '1500,5'),
      spend(2, '06.09.2026 11:00', '200,00'),
      spend(3, '07.09.2026 09:00', '50'),
    ]);
    expect(await upload(csv, 'promo.csv')).toMatchObject({
      status: 'imported',
      rows: 3,
      inserted: 1,
      matched: 2,
    });
    expect(await promoOps()).toHaveLength(3);
    expect(sum(await promoOps())).toBe(-175050);
  });

  it('P&L WB с файлом — те же числа; API-импорт WB строки файла не снимает', async () => {
    await wb.importPeriod(SELLER, SEPT, NOW);
    const before = (await finance.build(SELLER, SEPT, NOW, { marketplace: 'wb' })).pnl;
    expect(before.byArticle.withholdings.kopecks).toBe(-170050);

    await upload(FILE);
    const after = (await finance.build(SELLER, SEPT, NOW, { marketplace: 'wb' })).pnl;
    expect(after.netKopecks).toBe(before.netKopecks);
    expect(after.marketplaceKopecks).toBe(before.marketplaceKopecks);
    expect(after.revenueKopecks).toBe(before.revenueKopecks);
    expect(after.tax.taxKopecks).toBe(before.tax.taxKopecks);
    expect(after.byArticle.promotion_report.kopecks).toBe(-170050);

    // Новая версия отчёта реализации: findStale ищет по своему ключу периода.
    wbRows = [{ ...wbRows[0], rrd_id: 11 }];
    await wb.importPeriod(SELLER, SEPT, NOW);
    expect(await promoOps()).toHaveLength(2);
  });

  it('без подключения WB — отказ до разбора и записи', async () => {
    connection = null;
    await expect(upload(FILE)).rejects.toBeInstanceOf(WbNotConnectedError);
    expect(await wbOps()).toHaveLength(0);
  });
});
