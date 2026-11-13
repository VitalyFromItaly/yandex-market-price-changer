import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { AccountingCostHistoryService } from '../../src/modules/accounting/accounting-cost-history.service';
import { AccountingTaxSettingsService } from '../../src/modules/accounting/accounting-tax-settings.service';
import { AccountingCostSettingsService } from '../../src/modules/accounting/accounting-cost-settings.service';
import { AccountingLotCostService } from '../../src/modules/accounting/accounting-lot-cost.service';
import { AccountingManualOperationRepository } from '../../src/database/postgres/repositories/accounting-manual-operation.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { MarketplaceConnection } from '../../src/database/schemas/marketplace-connection.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { MarketplaceConnectionService } from '../../src/database/services/marketplace-connection.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import { AccountingReconcileService } from '../../src/modules/accounting/accounting-reconcile.service';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import {
  changedFields,
  validateManualOperationInput,
} from '../../src/modules/accounting/manual-operation.domain';
import { ProductCatalogService } from '../../src/modules/products/product-catalog.service';
import { CrmAccountingController } from '../../src/modules/crm/accounting/crm-accounting.controller';
import {
  INVALID_MANUAL_OPERATION,
  MANUAL_OPERATION_NOT_FOUND,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { WbFinanceService } from '../../src/modules/wb/wb-finance.service';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb, type ITestFinanceDb } from '../helpers/test-postgres';

/**
 * Ручные операции реестра «Финучёта» (TASK-208): проверка ввода, хранение с
 * журналом изменений, идемпотентность формы и то, что текущий P&L их не видит.
 */

const FORM = {
  marketplace: 'ozon',
  article: 'compensations',
  subArticle: 'loss_compensation',
  amount: '1 500,50',
  accruedOn: '2026-10-15',
  orderId: '0123-0001-1',
  source: 'Письмо поддержки Ozon',
  documentNumber: 'SR-77',
};

describe('ввод ручной операции', () => {
  it('целые копейки со знаком, дата, обязательный источник', () => {
    const ok = validateManualOperationInput({ ...FORM, amount: '−1 500,50' });
    expect(ok).toMatchObject({
      ok: true,
      value: { amountKopecks: -150050, sku: null, note: null },
    });
    expect(validateManualOperationInput({ ...FORM, amount: 0 })).toMatchObject({
      ok: false,
      field: 'amount',
    });
    expect(validateManualOperationInput({ ...FORM, amount: 'abc' })).toMatchObject({
      field: 'amount',
    });
    expect(validateManualOperationInput({ ...FORM, accruedOn: '2026-02-30' })).toMatchObject({
      field: 'accruedOn',
    });
    expect(validateManualOperationInput({ ...FORM, source: '   ' })).toMatchObject({
      field: 'source',
    });
    expect(validateManualOperationInput({ ...FORM, marketplace: 'avito' })).toMatchObject({
      field: 'marketplace',
    });
    // «Не распознано» руками не вносится: ручная операция — по определению известная.
    expect(validateManualOperationInput({ ...FORM, article: 'unknown' })).toMatchObject({
      field: 'article',
    });
    expect(validateManualOperationInput({ ...FORM, subArticle: 'прочее' })).toMatchObject({
      field: 'subArticle',
    });
    expect(validateManualOperationInput({ ...FORM, subArticle: '' })).toMatchObject({
      ok: true,
      value: { subArticle: null },
    });
  });
});

describe('хранение и журнал изменений (PGlite)', () => {
  let pg: ITestFinanceDb;
  let repo: AccountingManualOperationRepository;
  let service: AccountingManualOperationsService;
  const actor = { author: '222' };
  const KEY = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    pg = await createTestFinanceDb();
    repo = new AccountingManualOperationRepository(pg.db);
    service = new AccountingManualOperationsService(repo);
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  beforeEach(async () => {
    await pg.reset();
  });

  it('внести, отредактировать, удалить — журнал показывает три записи, история не теряется', async () => {
    const { row, created } = await service.create('222', { ...FORM, clientKey: KEY }, actor);
    expect(created).toBe(true);
    await service.update(
      '222',
      row.id,
      { ...FORM, amount: '2000' },
      { author: '222', impersonatedBy: '1' },
    );
    await service.remove('222', row.id, actor);

    expect(await service.list('222')).toEqual([]);
    const history = await service.history('222', row.id);
    expect(history.map((h) => h.action)).toEqual(['create', 'update', 'delete']);
    expect(history[0]).toMatchObject({ before: null, after: { amountKopecks: 150050 } });
    expect(history[1]).toMatchObject({
      before: { amountKopecks: 150050 },
      after: { amountKopecks: 200000 },
      impersonatedBy: '1',
    });
    expect(changedFields(history[1].before, history[1].after)).toEqual(['amountKopecks']);
    expect(history[2]).toMatchObject({ before: { amountKopecks: 200000 }, after: null });
  });

  it('повторная отправка той же формы не создаёт дубль и второй записи журнала', async () => {
    const first = await service.create('222', { ...FORM, clientKey: KEY }, actor);
    const second = await service.create('222', { ...FORM, clientKey: KEY }, actor);
    expect(second).toMatchObject({ created: false, row: { id: first.row.id } });
    expect(await service.list('222')).toHaveLength(1);
    expect(await service.history('222', first.row.id)).toHaveLength(1);
    // Тот же ключ у другого продавца — своя операция.
    expect((await service.create('333', { ...FORM, clientKey: KEY }, actor)).created).toBe(true);
  });

  it('правка без изменений и повторное удаление журнал не пополняют', async () => {
    const { row } = await service.create('222', { ...FORM, clientKey: KEY }, actor);
    await service.update('222', row.id, FORM, actor);
    await service.remove('222', row.id, actor);
    await service.remove('222', row.id, actor);
    expect((await service.history('222', row.id)).map((h) => h.action)).toEqual([
      'create',
      'delete',
    ]);
  });

  it('чужая и несуществующая — «не найдена»; без ключа формы — ошибка поля', async () => {
    const { row } = await service.create('222', { ...FORM, clientKey: KEY }, actor);
    await expect(service.update('333', row.id, FORM, actor)).rejects.toThrow('не найдена');
    await expect(service.remove('222', 'not-a-uuid', actor)).rejects.toThrow('не найдена');
    await expect(service.history('333', row.id)).rejects.toThrow('не найдена');
    await expect(service.create('222', FORM, actor)).rejects.toMatchObject({ field: 'clientKey' });
  });

  it('текущий P&L ручные операции не видит (accounting_beside_current)', async () => {
    await service.create('222', { ...FORM, clientKey: KEY }, actor);
    const operations = new FinanceOperationRepository(pg.db);
    const from = new Date('2026-09-30T21:00:00Z');
    const to = new Date('2026-10-31T21:00:00Z');
    for (const marketplace of ['ym', 'ozon', 'wb'] as const) {
      expect(await operations.liveForPnl('222', from, to, marketplace)).toEqual([]);
    }
    // А новый движок — видит.
    expect(await service.liveFor('222', { from: '2026-10-01', to: '2026-10-31' })).toHaveLength(1);
    expect(await service.liveFor('222', { from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
  });
});

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

describe('CRM «Финучёт» — ручные операции по HTTP', { timeout: 60_000 }, () => {
  let pg: ITestFinanceDb;
  let app: INestApplication;
  let base: string;
  let token: string;

  beforeAll(async () => {
    pg = await createTestFinanceDb();
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  afterEach(async () => {
    await app?.close();
  });

  async function boot(features: Record<string, boolean>) {
    await pg.reset();
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      { telegramUserId: SELLER_ID, campaign_id: '1', business_id: '2', token: 'SECRET' },
    ]);
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
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        { provide: PurchasePriceService, useValue: {} },
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
        PurchasePriceService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmAccountingController],
      providers: [
        AccountingManualOperationsService,
        {
          provide: AccountingManualOperationRepository,
          useValue: new AccountingManualOperationRepository(pg.db),
        },
        { provide: AccountingService, useValue: { status: () => ({ ready: false }) } },
        { provide: WbFinanceService, useValue: {} },
        { provide: AccountingReconcileService, useValue: {} },
        { provide: AccountingCostHistoryService, useValue: {} },
        { provide: AccountingTaxSettingsService, useValue: {} },
        { provide: AccountingCostSettingsService, useValue: {} },
        { provide: AccountingLotCostService, useValue: {} },
        { provide: ProductCatalogService, useValue: {} },
      ],
    })
    class AccountingTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AccountingTestModule] })
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
    return fetch(`${base}/api/crm/ym/accounting/manual-operations${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const KEY = '22222222-2222-4222-8222-222222222222';

  it('без fin_accounting — 403 FEATURE_DISABLED, в базу ничего не попало', async () => {
    await boot({});
    const response = await call('POST', '', { ...FORM, clientKey: KEY });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    expect(await new AccountingManualOperationRepository(pg.db).list(SELLER_ID)).toEqual([]);
  });

  it('внести → изменить → удалить: вид раздела, коды ошибок, история словами', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true });

    const empty = await (await call('GET', '')).json();
    expect(empty.items).toEqual([]);
    expect(empty.options.articles.map((a: { key: string }) => a.key)).not.toContain('unknown');
    expect(empty.options.subArticles.map((a: { key: string }) => a.key)).not.toContain('unknown');

    const created = await call('POST', '', { ...FORM, clientKey: KEY });
    expect(created.status).toBe(201);
    const view = await created.json();
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      marketplaceLabel: 'Ozon',
      articleLabel: 'Компенсации',
      subArticleLabel: 'Компенсация утраты или порчи',
      amountKopecks: 150050,
      source: 'Письмо поддержки Ozon',
    });
    expect(JSON.stringify(view)).not.toContain('telegramUserId');

    // Двойной клик — тот же вид, без дубля.
    const again = await (await call('POST', '', { ...FORM, clientKey: KEY })).json();
    expect(again.items).toHaveLength(1);

    const bad = await call('POST', '', { ...FORM, clientKey: KEY, source: '' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: INVALID_MANUAL_OPERATION, field: 'source' });

    const id = view.items[0].id;
    expect((await call('PUT', `/${id}`, { ...FORM, amount: '-99' })).status).toBe(200);
    expect((await call('DELETE', `/${id}`)).status).toBe(200);
    const missing = await call('PUT', '/00000000-0000-4000-8000-000000000000', FORM);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe(MANUAL_OPERATION_NOT_FOUND);

    const history = await (await call('GET', `/${id}/history`)).json();
    expect(history.items.map((h: { actionLabel: string }) => h.actionLabel)).toEqual([
      'Создана',
      'Изменена',
      'Удалена',
    ]);
    // Разряды ru-RU — неразрывный пробел; сравнение — по обычному.
    const plain = (text: string | null) => text?.replace(/\s/g, ' ') ?? null;
    expect(
      history.items[1].changes.map((c: { field: string; before: string; after: string }) => ({
        field: c.field,
        before: plain(c.before),
        after: plain(c.after),
      })),
    ).toEqual([{ field: 'Сумма', before: '1 500,50 ₽', after: '-99,00 ₽' }]);
  });
});
