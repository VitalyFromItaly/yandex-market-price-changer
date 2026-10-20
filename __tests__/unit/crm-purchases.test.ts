import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmPurchasesController } from '../../src/modules/crm/purchases/crm-purchases.controller';
import {
  INVALID_PURCHASE,
  PURCHASE_NOT_FOUND,
} from '../../src/modules/crm/purchases/crm-purchases.domain';
import { FinanceCashflowService } from '../../src/modules/finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb, type ITestFinanceDb } from '../helpers/test-postgres';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

/**
 * «Закупки» CRM (TASK-122) на настоящем HTTP: гейт фичи, коды ошибок, запись в
 * Postgres (PGlite). ДДС переехал в «Финансы» — его тест в crm-finance.test.ts.
 */
describe('CRM «Закупки» по HTTP', { timeout: 60_000 }, () => {
  let pg: ITestFinanceDb;
  let app: INestApplication;
  let stores: ReturnType<typeof inMemoryModel>;
  let base: string;
  let token: string;

  beforeAll(async () => {
    pg = await createTestFinanceDb();
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  async function boot(features: Record<string, boolean> = { [FEATURE.PURCHASES]: true }) {
    await pg.reset();
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        campaign_id: '12345678',
        business_id: '87654321',
        token: 'SECRET-TOKEN',
        commissionPercent: 23,
      },
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
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        {
          provide: PurchasePriceService,
          useValue: {
            listNamesAndCategories: async () => [{ name: 'CASIO G-Shock' }, { name: 'Прочее' }],
          },
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
        PurchasePriceService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    // Контроллер и сервис напрямую, репозиторий — на PGlite: PostgresModule
    // поднял бы пул к настоящей базе.
    @Module({
      imports: [CrmModule],
      controllers: [CrmPurchasesController],
      providers: [
        FinanceExpensesService,
        FinancePurchasesService,
        FinanceCashflowService,
        { provide: FinanceExpenseRepository, useValue: new FinanceExpenseRepository(pg.db) },
        { provide: FinancePurchaseRepository, useValue: new FinancePurchaseRepository(pg.db) },
        { provide: FinanceOperationRepository, useValue: new FinanceOperationRepository(pg.db) },
      ],
    })
    class PurchasesTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [PurchasesTestModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    const login = await post('/api/crm/auth/login', { login: 'vasya', password: INITIAL });
    const first = ((await login.json()) as { token: string }).token;
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    token = ((await change.json()) as { token: string }).token;
  }

  function post(path: string, body: unknown) {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function call(method: string, path: string, body?: unknown) {
    return fetch(`${base}/api/crm/ym/purchases${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  const batch = { supplier: 'ООО Восток', paidDay: '2026-10-03', amount: '150 000' };

  it('фича выключена — 403 FEATURE_DISABLED на чтении и записи, в базу ничего не попало', async () => {
    await boot({});
    for (const [method, path, body] of [
      ['GET', ''],
      ['POST', '', batch],
      ['POST', '/tax-payments', { paidDay: '2026-10-25', amount: 100 }],
    ] as const) {
      const response = await call(method, path, body);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    }
    expect(await new FinancePurchaseRepository(pg.db).listPurchases(SELLER_ID)).toEqual([]);
  });

  it('правка и удаление отвечают полным видом; ДДС здесь больше нет — он в «Финансах»', async () => {
    await boot();
    const created = await call('POST', '', {
      ...batch,
      lines: [{ sku: 'W1', name: 'Часы', count: 3, price: 50_000 }],
    });
    expect(created.status).toBe(201);
    const view = (await created.json()) as {
      purchases: { id: string; amountKopecks: number; lines: unknown[] }[];
    };
    expect(view.purchases).toHaveLength(1);
    expect(view.purchases[0]).toMatchObject({ amountKopecks: 15_000_000 });
    // Значение целиком, в кавычках: голое «222» встречается внутри случайного uuid записи
    // (~0,5 % прогонов) — так тест и мигал (TASK-174).
    expect(JSON.stringify(view)).not.toContain('telegramUserId');
    expect(JSON.stringify(view)).not.toContain(`"${SELLER_ID}"`);

    const id = view.purchases[0].id;
    const updated = await call('PUT', `/${id}`, { ...batch, paidDay: '2026-09-30' });
    expect(updated.status).toBe(200);
    expect(
      ((await updated.json()) as { purchases: { paidDay: string }[] }).purchases[0].paidDay,
    ).toBe('2026-09-30');

    const removed = (await (await call('DELETE', `/${id}`)).json()) as { purchases: unknown[] };
    expect(removed.purchases).toEqual([]);

    // Переехал в /crm/ym/finance/cashflow (решение finance_crm_cashflow_moved).
    expect((await call('GET', '/cashflow?from=2026-10-01&to=2026-10-31')).status).toBe(404);
  });

  it('400 INVALID_PURCHASE с полем; 404 на чужую и несуществующую запись', async () => {
    await boot();
    const bad = await call('POST', '', {
      ...batch,
      amount: 100,
      lines: [{ sku: 'W1', count: 1, price: 1 }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: INVALID_PURCHASE, field: 'lines' });

    const other = await new FinancePurchaseRepository(pg.db).createPurchase('333', {
      supplier: 'Чужой',
      paidDay: '2026-10-01',
      amountKopecks: 100,
      lines: null,
      note: null,
    });
    for (const [method, path] of [
      ['PUT', `/${other.id}`],
      ['DELETE', `/${other.id}`],
      ['DELETE', '/not-a-uuid'],
      ['DELETE', `/tax-payments/${other.id}`],
    ] as const) {
      const response = await call(method, path, batch);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe(PURCHASE_NOT_FOUND);
    }
  });
});
