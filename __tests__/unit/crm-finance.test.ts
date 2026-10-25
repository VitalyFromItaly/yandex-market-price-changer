import type { INestApplication } from '@nestjs/common';
import type { ICrmPnlView } from '../../src/modules/crm/finance/crm-finance.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { financeDocuments } from '../../src/database/postgres/finance.schema';
import { FinanceAnomalyRepository } from '../../src/database/postgres/repositories/finance-anomaly.repository';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { MarketplaceConnection } from '../../src/database/schemas/marketplace-connection.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { MarketplaceConnectionService } from '../../src/database/services/marketplace-connection.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmFinanceController } from '../../src/modules/crm/finance/crm-finance.controller';
import {
  FINANCE_DOCUMENT_NOT_FOUND,
  INVALID_FINANCE_REQUEST,
} from '../../src/modules/crm/finance/crm-finance.domain';
import { CrmFinanceKinds } from '../../src/modules/crm/finance/crm-finance.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import type { IAnomaly } from '../../src/modules/finance/finance-anomalies';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { FinanceImportService } from '../../src/modules/finance/finance-import.service';
import {
  FinanceImportScheduler,
  FinancePullNotAllowedError,
} from '../../src/modules/telegram/queue/services/finance-import.scheduler';
import {
  financePeriodKey,
  financeToday,
  monthPeriod,
} from '../../src/modules/finance/finance-period';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { screenMonths } from '../../src/modules/finance/finance-screen';
import { FinanceScreenService } from '../../src/modules/finance/finance-screen.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import * as XLSX from 'xlsx';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Финансы» CRM (TASK-124): P&L месяца через kind, раскрытие статьи до
 * операций и оригинала отчёта, ДДС (переехал из «Закупок»), сверка месяца —
 * на PGlite и настоящем HTTP.
 */

const INITIAL = 'tg_rules_2026';
const SELLER = '222';
const OTHER = '333';
const SEPT = monthPeriod(2026, 9);
const SEPT_KEY = financePeriodKey('united-netting', SEPT);
const OCT_15 = new Date('2026-10-15T09:00:00Z');

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 2,
  transactionSum: 5000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '20.09.2026',
  bankSum: 5000,
  ...over,
});

const delivery = (orderId: number, sum: number) =>
  row({
    orderId,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: 'Доставка покупателю',
    transactionSum: sum,
    count: null,
    actDate: '30.09.2026',
  });

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let screen: FinanceScreenService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  periods = new FinancePeriodRepository(pg.db);
  screen = new FinanceScreenService(
    operations,
    documents,
    periods,
    new FinanceDiscrepancyRepository(pg.db),
    new FinanceCorrectionRepository(pg.db),
    new FinanceAnomalyRepository(pg.db),
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function seed(rows: Record<string, unknown>[], telegramUserId = SELLER, content = 'zip') {
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: SEPT.from,
    periodTo: SEPT.to,
    buffer: Buffer.from(content),
    filename: 'united-netting-2026-09-01-2026-09-30.zip',
    contentType: 'application/zip',
  });
  const keys = journalKeys(rows);
  await operations.upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: SEPT_KEY,
      }),
    ),
  );
  return document;
}

function financeService() {
  return new FinanceService(
    operations,
    periods,
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    new FinanceExpensesService(new FinanceExpenseRepository(pg.db)),
    { findByTelegramUser: async () => null } as never,
    { findBySkus: async () => new Map([['A1', { price: 1500 }]]) } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
}

const kinds = () => new CrmFinanceKinds({ register: vi.fn() } as never, financeService());
const contextOf = (params: Record<string, unknown>, features: Record<string, boolean> = {}) =>
  ({ telegramUserId: SELLER, store: {} as never, params, features }) as const;

describe('kind finance:pnl', () => {
  beforeEach(async () => {
    await pg.reset();
  });

  it('статья раскрывается ровно в свои операции; у операции — оригинал её версии', async () => {
    const document = await seed([row(), delivery(1, -200), delivery(2, -150.5)]);
    await seed([delivery(9, -999)], OTHER, 'other');

    const { data } = await kinds().run(contextOf({ month: '2026-09' }), OCT_15);
    const view = data as ICrmPnlView;
    expect(view).toMatchObject({ month: '2026-09', from: SEPT.from, to: SEPT.to });
    // Журнал загружен, статуса периода нет — предварительно, плоской оценки нет (не текущий месяц).
    expect(view.statusLabel).toBe('Предварительные данные');
    expect(view.flat).toBeNull();
    expect(view.flatNote).not.toBeNull();

    const logistics = view.sections
      .flatMap((section) => section.articles)
      .find((article) => article.article === 'delivery_to_buyer');
    expect(logistics?.kopecks).toBe(-35_050);
    expect(logistics?.operationIds).toHaveLength(2);

    const ops = await screen.operationsByIds(SELLER, logistics?.operationIds);
    expect(ops.reduce((sum, op) => sum + op.amountKopecks, 0)).toBe(logistics?.kopecks);
    expect(new Set(ops.map((op) => op.documentId))).toEqual(new Set([document.id]));

    const original = await screen.original(SELLER, document.id);
    expect(original?.buffer.toString()).toBe('zip');
    expect(original?.filename).toBe('united-netting-2026-09-01-2026-09-30.zip');
    // Чужой продавец не видит ни операций, ни оригинала.
    expect(await screen.operationsByIds(OTHER, logistics?.operationIds)).toEqual([]);
    expect(await screen.original(OTHER, document.id)).toBeNull();

    // Разделы сложены из статей, и вид не тащит пустые статьи.
    for (const section of view.sections) {
      expect(section.kopecks).toBe(section.articles.reduce((s, a) => s + a.kopecks, 0));
      for (const article of section.articles)
        expect(article.operationIds.length).toBeGreaterThan(0);
    }
  });

  it('продавец только с Ozon (TASK-179): без документа ЯМ «Прибыль» Ozon считается', async () => {
    const ozonOnly = { ...contextOf({ month: '2026-09', marketplace: 'ozon' }), store: null };
    const { data } = await kinds().run({ ...ozonOnly, features: { [FEATURE.OZON]: true } }, OCT_15);
    expect(data).toMatchObject({ month: '2026-09', marketplace: 'ozon' });

    // Закрытая площадка и мусор — отказ той же функцией, что у POST задачи.
    await expect(kinds().run(ozonOnly, OCT_15)).rejects.toThrow('«Ozon» закрыта');
    await expect(
      kinds().run(contextOf({ month: '2026-09', marketplace: 'amazon' }), OCT_15),
    ).rejects.toThrow('Площадка указана неверно');
  });

  it('мусор вместо месяца — понятный отказ, а не сбой', async () => {
    await expect(kinds().run(contextOf({ month: '09-2026' }), OCT_15)).rejects.toBeInstanceOf(
      CrmJobError,
    );
  });
});

describe('CRM «Финансы» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;

  const pulls = {
    pullNow: vi.fn(async (_user: string, _mp: string, months: { month: string }[]) => ({
      queued: months.map((month) => month.month),
      cooldown: [],
    })),
  };

  async function boot(features: Record<string, boolean> = { [FEATURE.FINANCE]: true }) {
    await pg.reset();
    pulls.pullNow.mockClear();
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        { provide: getModelToken(MarketplaceConnection.name), useValue: inMemoryModel() },
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        {
          provide: getModelToken(UserAccess.name),
          useValue: inMemoryModel([
            {
              telegramUserId: SELLER,
              botId: '999',
              status: 'approved',
              username: 'Vasya',
              features,
            },
          ]),
        },
        {
          provide: getModelToken(YandexMarket.name),
          useValue: inMemoryModel([
            { telegramUserId: SELLER, campaign_id: '12345678', business_id: '1', token: 't' },
          ]),
        },
        {
          provide: AppConfigService,
          useValue: { isAdmin: () => false, crmInitialPassword: INITIAL },
        },
      ],
      exports: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmFinanceController],
      providers: [
        FinanceExpensesService,
        FinancePurchasesService,
        FinanceCashflowService,
        { provide: FinanceScreenService, useValue: screen },
        { provide: FinanceExpenseRepository, useValue: new FinanceExpenseRepository(pg.db) },
        { provide: FinancePurchaseRepository, useValue: new FinancePurchaseRepository(pg.db) },
        { provide: FinanceOperationRepository, useValue: operations },
        { provide: FinanceImportScheduler, useValue: pulls },
        {
          provide: FinanceImportService,
          useValue: new FinanceImportService(
            { findByTelegramUser: async () => ({ business_id: '1' }) } as never,
            { forStore: vi.fn() } as never,
            documents,
            operations,
            new FinanceCorrectionRepository(pg.db),
            { report: vi.fn() } as never,
            pg.db,
            periods,
            { reconcilePeriod: vi.fn(async () => ({ state: 'skipped' })) } as never,
            { detectPeriod: vi.fn(async () => ({ periodKey: '', anomalies: [] })) } as never,
            new FinanceActServicesRepository(pg.db),
          ),
        },
      ],
    })
    class FinanceTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [FinanceTestModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    const login = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'vasya', password: INITIAL }),
    });
    const first = ((await login.json()) as { token: string }).token;
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    token = ((await change.json()) as { token: string }).token;
  }

  function call(method: string, path: string, body?: unknown) {
    return fetch(`${base}/api/crm/ym/finance${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  /** Прошлый месяц от сегодняшнего: тест не протухает через год. */
  const uploadMonth = () => screenMonths(financeToday(new Date()))[1].month;

  function xlsxFile(header: string[], rows: unknown[][]): Uint8Array {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Лист1');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  const NETTING_HEADER = [
    'Номер заказа',
    'Тип транзакции',
    'Источник транзакции',
    'Дата транзакции',
    'Сумма транзакции',
  ];

  function uploadFile(
    name: string,
    content: Uint8Array,
    month: string | null = uploadMonth(),
  ): Promise<Response> {
    const form = new FormData();
    if (month !== null) form.append('month', month);
    form.append('file', new Blob([content]), name);
    return fetch(`${base}/api/crm/ym/finance/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  }

  it('«Загрузить из Маркета»: только при finance И finance_pull (403 FEATURE_DISABLED)', async () => {
    await boot({ [FEATURE.FINANCE]: true });
    const response = await call('POST', '/pull', { months: [uploadMonth()] });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    expect(pulls.pullNow).not.toHaveBeenCalled();
  });

  it('«Загрузить из Маркета»: месяцы — от свежего, без повторов; 202 с итогом планировщика', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.FINANCE_PULL]: true });
    const [current, previous] = screenMonths(financeToday(new Date()));

    const response = await call('POST', '/pull', {
      months: [previous.month, current.month, previous.month],
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: [current.month, previous.month], cooldown: [] });
    const [user, marketplace, months] = pulls.pullNow.mock.calls[0];
    expect([user, marketplace]).toEqual([SELLER, 'ym']);
    expect(months).toEqual([current, previous]);
  });

  it('«Загрузить из Маркета»: 400 на пустой, чужой и мусорный месяц; 409, если журнал не положен', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.FINANCE_PULL]: true });
    for (const months of [undefined, [], ['2020-01'], ['10-2026'], 'x']) {
      const response = await call('POST', '/pull', { months });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ field: 'months' });
    }
    expect(pulls.pullNow).not.toHaveBeenCalled();

    pulls.pullNow.mockRejectedValueOnce(new FinancePullNotAllowedError());
    const refused = await call('POST', '/pull', { months: [uploadMonth()] });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'FINANCE_PULL_NOT_ALLOWED' });
  });

  it('загрузка отчёта — только при finance И finance_upload (403 FEATURE_DISABLED)', async () => {
    await boot({ [FEATURE.FINANCE]: true });
    const response = await uploadFile('отчёт.xlsx', xlsxFile(NETTING_HEADER, []));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    expect(await pg.db.select().from(financeDocuments)).toHaveLength(0);
  });

  it('загрузка отчёта: кириллица в имени, итог, тот же файл повторно — unchanged', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.FINANCE_UPLOAD]: true });
    const file = xlsxFile(NETTING_HEADER, [
      ['1', 'Начисление', 'Платёж покупателя', '16.09.2026 14:05', '5000'],
      ['1', 'Удержание', 'Оплата услуг Маркета', '16.09.2026 14:05', '-200,5'],
    ]);

    const response = await uploadFile('Отчёт по платежам.xlsx', file);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'imported',
      month: uploadMonth(),
      rows: 2,
      inserted: 2,
      matched: 0,
    });
    const [document] = await pg.db.select().from(financeDocuments);
    expect(document).toMatchObject({
      source: 'manual',
      originalFilename: 'Отчёт по платежам.xlsx',
    });

    const again = await uploadFile('Отчёт по платежам.xlsx', file);
    expect(await again.json()).toMatchObject({ status: 'unchanged', rows: 2 });
  });

  it('загрузка отчёта: отказы с кодами под полем', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.FINANCE_UPLOAD]: true });
    const body = async (response: Response) =>
      (await response.json()) as { code: string; field?: string; missing?: string[] };

    const big = await uploadFile('big.xlsx', new Uint8Array(15 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect(await body(big)).toMatchObject({ code: 'FILE_TOO_LARGE', field: 'file' });

    const ext = await uploadFile('report.pdf', new Uint8Array([1]));
    expect(ext.status).toBe(400);
    expect(await body(ext)).toMatchObject({ code: 'INVALID_FILE', field: 'file' });

    const noMonth = await uploadFile('a.xlsx', xlsxFile(NETTING_HEADER, []), '2020-01');
    expect(noMonth.status).toBe(400);
    expect(await body(noMonth)).toMatchObject({ code: INVALID_FINANCE_REQUEST, field: 'month' });

    const unknown = await uploadFile(
      'a.xlsx',
      xlsxFile(['Дата транзакции', 'Что-то'], [['1', '2']]),
    );
    expect(unknown.status).toBe(400);
    expect(await body(unknown)).toMatchObject({
      code: 'FINANCE_FILE_UNRECOGNIZED',
      field: 'file',
      missing: ['Сумма транзакции', 'Тип транзакции', 'Источник транзакции'],
    });

    const services = await uploadFile(
      'services.xlsx',
      xlsxFile(['Номер заказа', 'Название услуги'], [['1', 'Доставка']]),
    );
    expect(await body(services)).toMatchObject({ code: 'FINANCE_FILE_WRONG_REPORT' });
    expect(await pg.db.select().from(financeDocuments)).toHaveLength(0);
  });

  it('фича finance выключена — 403 FEATURE_DISABLED на каждом адресе', async () => {
    await boot({});
    const document = await seed([row()]);
    for (const [method, path, body] of [
      ['GET', '/months'],
      ['POST', '/operations', { ids: [document.id] }],
      ['GET', `/documents/${document.id}/original`],
      ['GET', '/cashflow?month=2026-09'],
      ['GET', '/discrepancies?month=2026-09'],
      ['GET', '/corrections?month=2026-09'],
    ] as const) {
      const response = await call(method, path, body);
      expect(response.status, path).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    }
  });

  it('месяцы со статусом, операции и оригинал отчёта с именем файла', async () => {
    await boot();
    const document = await seed([row(), delivery(1, -200)]);
    await periods.upsert({
      marketplace: 'ym',
      telegramUserId: SELLER,
      reportType: 'united-netting',
      periodKey: SEPT_KEY,
      periodFrom: SEPT.from,
      periodTo: SEPT.to,
      checkedAt: new Date(),
      status: 'discrepancy',
      lastOutcome: 'imported',
      documentVersion: 1,
      unknownCount: 0,
      changedCount: 1,
      removedCount: 0,
      discrepancyCount: 1,
      reconcileState: 'checked',
      reconcileNote: null,
      error: null,
    });

    const { months } = (await (await call('GET', '/months')).json()) as {
      months: { month: string; statusLabel: string; discrepancyCount: number }[];
    };
    expect(months).toHaveLength(13);
    expect(months.find((m) => m.month === '2026-09')).toMatchObject({
      statusLabel: 'Есть расхождения',
      discrepancyCount: 1,
    });
    expect(JSON.stringify(months)).not.toContain(SELLER);

    const ids = (await operations.liveForPnl(SELLER, new Date(0), new Date('2027-01-01'))).map(
      (op) => op.id,
    );
    const ops = await call('POST', '/operations', { ids });
    expect(ops.status).toBe(201);
    const { items } = (await ops.json()) as {
      items: { articleTitle: string; amountKopecks: number; documentId: string }[];
    };
    expect(items.map((op) => op.articleTitle).sort()).toEqual(
      ['Логистика до покупателя', 'Продажи'].sort(),
    );
    expect(JSON.stringify(items)).not.toContain('raw');

    const file = await call('GET', `/documents/${items[0].documentId}/original`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('application/zip');
    expect(file.headers.get('content-disposition')).toContain("filename*=UTF-8''united-netting");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('zip');

    expect(document.id).toBe(items[0].documentId);
  });

  it('ДДС месяца видит закупку; сверка и корректировки — только своего месяца', async () => {
    await boot();
    await new FinancePurchaseRepository(pg.db).createPurchase(SELLER, {
      supplier: 'ООО Восток',
      paidDay: '2026-10-03',
      amountKopecks: 15_000_000,
      lines: null,
      note: null,
    });
    const cash = (await (await call('GET', '/cashflow?month=2026-10')).json()) as {
      outflow: { purchasesKopecks: number };
      receivable: { asOf: string };
    };
    expect(cash.outflow.purchasesKopecks).toBe(15_000_000);

    const scope = { marketplace: 'ym' as const, telegramUserId: SELLER, periodKey: SEPT_KEY };
    await new FinanceDiscrepancyRepository(pg.db).replacePeriod(scope, [
      {
        kind: 'payment_mismatch',
        bankOrderId: 'P1',
        operationIds: [],
        operationCount: 2,
        detail: 'Σ ≠ поручению',
      },
    ]);
    const disc = (await (await call('GET', '/discrepancies?month=2026-09')).json()) as {
      total: number;
      items: { kindLabel: string }[];
    };
    expect(disc.total).toBe(1);
    expect(disc.items[0].kindLabel).toBe('Сумма операций не равна выплате');
    const august = (await (await call('GET', '/discrepancies?month=2026-08')).json()) as {
      total: number;
    };
    expect(august.total).toBe(0);

    const side = {
      operationKey: 'k',
      amountKopecks: 100,
      accruedAt: new Date('2026-09-16T11:05:00Z'),
      article: 'sales',
      transactionType: 'Начисление',
    };
    const document = await seed([row()]);
    await new FinanceCorrectionRepository(pg.db).record(
      {
        marketplace: 'ym',
        telegramUserId: SELLER,
        businessId: 'b1',
        periodKey: SEPT_KEY,
        documentId: document.id,
        documentVersion: 2,
      },
      [{ kind: 'changed', before: side, after: { ...side, amountKopecks: 90 } }],
    );
    const corr = (await (await call('GET', '/corrections?month=2026-09')).json()) as {
      total: number;
      items: {
        before: { articleTitle: string; accruedAt: string };
        after: { amountKopecks: number };
      }[];
    };
    expect(corr.total).toBe(1);
    expect(corr.items[0].before).toMatchObject({
      articleTitle: 'Продажи',
      accruedAt: '2026-09-16T11:05:00.000Z',
    });
    expect(corr.items[0].after.amountKopecks).toBe(90);
  });

  const anomaly = (over: Partial<IAnomaly> = {}): IAnomaly => ({
    kind: 'penalty',
    key: `penalty:${SEPT_KEY}:Удержание · Штраф за опоздание`,
    fingerprint: '-50000:1',
    operationIds: ['op-1'],
    operationCount: 1,
    amountKopecks: -50_000,
    sku: null,
    orderId: null,
    threshold: 'любой штраф',
    detail: '«Удержание · Штраф за опоздание»: 1 строк на −500,00 ₽',
    ...over,
  });

  it('аномалии — только при finance И finance_anomalies (403 FEATURE_DISABLED)', async () => {
    await boot({ [FEATURE.FINANCE]: true });
    for (const [method, path, body] of [
      ['GET', '/anomalies?month=2026-09'],
      ['POST', '/anomalies/review', { keys: ['x'], reviewed: true }],
    ] as const) {
      const response = await call(method, path, body);
      expect(response.status, path).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    }
    await app.close();
    await boot({ [FEATURE.FINANCE_ANOMALIES]: true });
    expect((await call('GET', '/anomalies?month=2026-09')).status).toBe(403);
  });

  it('аномалии месяца: «не проверялся», список, «просмотрено» переживает перезамену', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.FINANCE_ANOMALIES]: true });
    type TView = {
      total: number;
      unreviewed: number;
      checkedAt: string | null;
      items: { key: string; kindLabel: string; reviewed: boolean; threshold: string }[];
    };
    const list = async (query = '') =>
      (await (await call('GET', `/anomalies?month=2026-09${query}`)).json()) as TView;

    expect(await list()).toEqual({ total: 0, unreviewed: 0, checkedAt: null, items: [] });

    await periods.upsert({
      marketplace: 'ym',
      telegramUserId: SELLER,
      reportType: 'united-netting',
      periodKey: SEPT_KEY,
      periodFrom: SEPT.from,
      periodTo: SEPT.to,
      status: 'preliminary',
      lastOutcome: 'imported',
      documentVersion: 1,
      unknownCount: 0,
      changedCount: 0,
      removedCount: 0,
      discrepancyCount: 0,
      reconcileState: null,
      reconcileNote: null,
      error: null,
      checkedAt: OCT_15,
    });
    const repo = new FinanceAnomalyRepository(pg.db);
    const scope = { marketplace: 'ym' as const, telegramUserId: SELLER, periodKey: SEPT_KEY };
    const other = anomaly({ kind: 'missing_cost', key: `missing_cost:${SEPT_KEY}:A1` });
    await repo.replacePeriod(scope, [anomaly(), other], OCT_15);
    // Чужой продавец с тем же ключом — его отметка не наша.
    await repo.replacePeriod({ ...scope, telegramUserId: OTHER }, [anomaly()], OCT_15);

    const first = await list();
    expect(first.checkedAt).toBe(OCT_15.toISOString());
    expect(first.total).toBe(2);
    expect(first.unreviewed).toBe(2);
    expect(first.items[0]).toMatchObject({ kindLabel: 'Штраф', reviewed: false });

    const review = await call('POST', '/anomalies/review', {
      keys: [anomaly().key, 'чужой-или-выдуманный'],
      reviewed: true,
    });
    expect(((await review.json()) as { updated: number }).updated).toBe(1);

    // Повторный прогон с тем же содержимым — без дублей, отметка на месте.
    await repo.replacePeriod(scope, [anomaly(), other], OCT_15);
    const second = await list();
    expect(second.total).toBe(2);
    expect(second.unreviewed).toBe(1);
    // Непросмотренные сверху.
    expect(second.items.map((i) => i.reviewed)).toEqual([false, true]);
    expect((await list('&unreviewed=1')).items.map((i) => i.key)).toEqual([other.key]);
    const others = await repo.list({ telegramUserId: OTHER, periodKey: SEPT_KEY });
    expect(others.items[0].reviewed).toBe(false);

    // Новый штраф того же вида — отпечаток другой, снова непросмотрено.
    await repo.replacePeriod(scope, [anomaly({ fingerprint: '-90000:2' }), other], OCT_15);
    expect((await list()).unreviewed).toBe(2);

    await call('POST', '/anomalies/review', { keys: [other.key], reviewed: true });
    await call('POST', '/anomalies/review', { keys: [other.key], reviewed: false });
    expect((await list()).unreviewed).toBe(2);
  });

  it('площадка экрана (TASK-180): вкладки ЯМ и Ozon не смешивают журнал; нет вкладки — причина', async () => {
    await boot({
      [FEATURE.FINANCE]: true,
      [FEATURE.FINANCE_ANOMALIES]: true,
      [FEATURE.OZON]: true,
    });
    const ozonKey = financePeriodKey('ozon-transaction-list', SEPT);
    const periodRow = (marketplace: 'ym' | 'ozon', reportType: string, periodKey: string) => ({
      marketplace,
      telegramUserId: SELLER,
      reportType,
      periodKey,
      periodFrom: SEPT.from,
      periodTo: SEPT.to,
      status: 'preliminary' as const,
      lastOutcome: 'imported' as const,
      documentVersion: 1,
      unknownCount: 0,
      changedCount: 0,
      removedCount: 0,
      discrepancyCount: 0,
      reconcileState: null,
      reconcileNote: null,
      error: null,
      checkedAt: OCT_15,
    });
    await periods.upsert(periodRow('ozon', 'ozon-transaction-list', ozonKey));

    const discrepancies = new FinanceDiscrepancyRepository(pg.db);
    const finding = (detail: string) => ({
      kind: 'payment_mismatch' as const,
      bankOrderId: 'P1',
      operationIds: [],
      operationCount: 1,
      detail,
    });
    const ym = { marketplace: 'ym' as const, telegramUserId: SELLER, periodKey: SEPT_KEY };
    const ozon = { marketplace: 'ozon' as const, telegramUserId: SELLER, periodKey: ozonKey };
    await discrepancies.replacePeriod(ym, [finding('ym')]);
    await discrepancies.replacePeriod(ozon, [finding('ozon-1'), finding('ozon-2')]);

    const ymDocument = await seed([row()]);
    const { document: ozonDocument } = await documents.registerVersion({
      marketplace: 'ozon',
      telegramUserId: SELLER,
      businessId: 'b1',
      reportType: 'ozon-transaction-list',
      periodFrom: SEPT.from,
      periodTo: SEPT.to,
      buffer: Buffer.from('json'),
      filename: 'ozon.json',
      contentType: 'application/json',
    });
    const side = {
      operationKey: 'k',
      amountKopecks: 100,
      accruedAt: new Date('2026-09-16T11:05:00Z'),
      article: 'sales',
      transactionType: 'Начисление',
    };
    const corrections = new FinanceCorrectionRepository(pg.db);
    for (const [scope, document] of [
      [ym, ymDocument],
      [ozon, ozonDocument],
    ] as const) {
      await corrections.record(
        { ...scope, businessId: 'b1', documentId: document.id, documentVersion: 2 },
        [{ kind: 'changed', before: side, after: { ...side, amountKopecks: 90 } }],
      );
    }
    // Аномалия Ozon под ключом периода ЯМ — фильтр по площадке, а не только по ключу.
    await new FinanceAnomalyRepository(pg.db).replacePeriod(
      { ...ym, marketplace: 'ozon' },
      [anomaly()],
      OCT_15,
    );

    const json = async (path: string) => (await call('GET', path)).json() as Promise<any>;

    const ymMonths = (await json('/months')).months as { month: string; status: unknown }[];
    const ozonMonths = (await json('/months?marketplace=ozon')).months as typeof ymMonths;
    expect(ymMonths.find((m) => m.month === '2026-09')?.status).toBeNull();
    expect(ozonMonths.find((m) => m.month === '2026-09')?.status).toBe('preliminary');

    expect((await json('/discrepancies?month=2026-09')).total).toBe(1);
    expect((await json('/discrepancies?month=2026-09&marketplace=ym')).total).toBe(1);
    expect((await json('/discrepancies?month=2026-09&marketplace=ozon')).total).toBe(2);
    expect((await json('/corrections?month=2026-09')).total).toBe(1);
    expect((await json('/corrections?month=2026-09&marketplace=ozon')).total).toBe(1);
    expect((await json('/anomalies?month=2026-09')).total).toBe(0);

    // ДДС Ozon (TASK-184) — из журнала площадки, а не причина.
    const ozonFlow = await json('/cashflow?month=2026-09&marketplace=ozon');
    expect(ozonFlow.unsupported).toBeUndefined();
    expect(ozonFlow).toHaveProperty('receivable');

    // Нет вкладки у площадки — причина, а не нули и не пустой список.
    for (const path of ['/anomalies?month=2026-09&marketplace=ozon']) {
      const view = await json(path);
      expect(view, path).toMatchObject({ unsupported: true });
      expect(view.note, path).toContain('Ozon');
      expect(view.total, path).toBeUndefined();
    }
    const review = await call('POST', '/anomalies/review?marketplace=ozon', {
      keys: ['x'],
      reviewed: true,
    });
    expect(review.status).toBe(400);

    // Мусор — 400, закрытая площадка — 403.
    const bad = await call('GET', '/months?marketplace=amazon');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: INVALID_FINANCE_REQUEST, field: 'marketplace' });
    const closed = await call('GET', '/discrepancies?month=2026-09&marketplace=wb');
    expect(closed.status).toBe(403);
    expect(((await closed.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
  });

  it('WB: сверки нет — причина (TASK-180); ДДС — из журнала (TASK-185); корректировки — свои', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.WB]: true });
    const discrepancies = await call('GET', '/discrepancies?month=2026-09&marketplace=wb');
    expect(discrepancies.status).toBe(200);
    expect(await discrepancies.json()).toMatchObject({ unsupported: true });
    const cashflow = await call('GET', '/cashflow?month=2026-09&marketplace=wb');
    expect(cashflow.status).toBe(200);
    const flow = (await cashflow.json()) as Record<string, unknown>;
    expect(flow.unsupported).toBeUndefined();
    expect(flow).toHaveProperty('receivable');
    expect(
      await (await call('GET', '/corrections?month=2026-09&marketplace=wb')).json(),
    ).toEqual({ total: 0, items: [] });
  });

  it('отметка аномалий: 400 на пустой список и не-boolean', async () => {
    await boot({ [FEATURE.FINANCE]: true, [FEATURE.FINANCE_ANOMALIES]: true });
    for (const [body, field] of [
      [{ keys: [], reviewed: true }, 'keys'],
      [{ keys: 'x', reviewed: true }, 'keys'],
      [{ keys: ['x'], reviewed: 'да' }, 'reviewed'],
    ] as const) {
      const response = await call('POST', '/anomalies/review', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: INVALID_FINANCE_REQUEST, field });
    }
  });

  it('400 на кривой месяц и id; 404 на чужой, несуществующий и мусорный оригинал', async () => {
    await boot();
    for (const path of [
      '/cashflow?month=09-2026',
      '/discrepancies',
      '/corrections?month=2026-13',
    ]) {
      const response = await call('GET', path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toMatchObject({
        code: INVALID_FINANCE_REQUEST,
        field: 'month',
      });
    }
    for (const body of [
      { ids: ['not-a-uuid'] },
      { ids: [] },
      {},
      { ids: Array(201).fill(SEPT_KEY) },
    ]) {
      const response = await call('POST', '/operations', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: INVALID_FINANCE_REQUEST, field: 'ids' });
    }
    const foreign = await seed([row()], OTHER, 'other');
    for (const id of [foreign.id, '00000000-0000-4000-8000-000000000000', 'junk']) {
      const response = await call('GET', `/documents/${id}/original`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: FINANCE_DOCUMENT_NOT_FOUND });
    }
  });
});
