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
import { MarketplaceConnection } from '../../src/database/schemas/marketplace-connection.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { MarketplaceConnectionService } from '../../src/database/services/marketplace-connection.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmExpensesController } from '../../src/modules/crm/expenses/crm-expenses.controller';
import {
  CATEGORY_IN_USE,
  EXPENSE_NOT_FOUND,
  INVALID_EXPENSE,
} from '../../src/modules/crm/expenses/crm-expenses.domain';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb, type ITestFinanceDb } from '../helpers/test-postgres';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

/**
 * «Расходы» CRM на настоящем HTTP: гейт фичи, коды ошибок, запись в Postgres
 * (PGlite) и то, что распределение на период сразу видит правку.
 */
describe('CRM «Расходы» по HTTP', { timeout: 60_000 }, () => {
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

  async function boot(features: Record<string, boolean> = { [FEATURE.EXPENSES]: true }) {
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
        MarketplaceConnectionService,
        { provide: getModelToken(MarketplaceConnection.name), useValue: inMemoryModel() },
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
        MarketplaceConnectionService,
        PurchasePriceService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    // Контроллер и сервис напрямую, репозиторий — на PGlite: PostgresModule
    // поднял бы пул к настоящей базе.
    @Module({
      imports: [CrmModule],
      controllers: [CrmExpensesController],
      providers: [
        FinanceExpensesService,
        { provide: FinanceExpenseRepository, useValue: new FinanceExpenseRepository(pg.db) },
      ],
    })
    class ExpensesTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ExpensesTestModule] })
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
    return fetch(`${base}/api/crm/ym/expenses${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  const rent = { kind: 'monthly', category: 'rent', amount: '30 000', fromDay: '2026-10-01' };

  it('фича выключена — 403 FEATURE_DISABLED на чтении и записи, в базу ничего не попало', async () => {
    await boot({});
    for (const [method, path, body] of [
      ['GET', ''],
      ['POST', '', rent],
      ['GET', '/allocation?from=2026-10-01&to=2026-10-31'],
    ] as const) {
      const response = await call(method, path, body);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    }
    expect(await new FinanceExpenseRepository(pg.db).list(SELLER_ID)).toEqual([]);
  });

  it('GET: предустановленные категории, пустой список, без telegramUserId', async () => {
    await boot();
    const response = await call('GET', '');
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.expenses).toEqual([]);
    expect(view.categories.map((c: { key: string }) => c.key)).toEqual([
      'supplier_delivery',
      'packaging',
      'warehouse',
      'salaries',
      'rent',
      'other',
    ]);
    expect(view.limits).toEqual({ noteMaxLength: 200, categoryNameMaxLength: 60 });
  });

  it('аренда 30 000 ₽/мес: неделя ≈ 7 000 ₽, правка суммы сразу видна в распределении', async () => {
    await boot();
    const created = await call('POST', '', rent);
    expect(created.status).toBe(201);
    const view = await created.json();
    expect(view.expenses).toHaveLength(1);
    const [expense] = view.expenses;
    expect(expense).toMatchObject({
      kind: 'monthly',
      category: 'rent',
      categoryLabel: 'Аренда',
      amountKopecks: 3_000_000,
      toDay: null,
    });
    // Значение целиком, в кавычках: голое «222» встречается внутри случайного uuid записи
    // (~0,5 % прогонов) — так тест и мигал (TASK-174).
    expect(JSON.stringify(view)).not.toContain('telegramUserId');
    expect(JSON.stringify(view)).not.toContain(`"${SELLER_ID}"`);

    const week = '/allocation?from=2026-10-05&to=2026-10-11';
    const before = await (await call('GET', week)).json();
    expect(before).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
      totalKopecks: 677_419,
      byCategory: [{ key: 'rent', label: 'Аренда', kopecks: 677_419 }],
    });

    const put = await call('PUT', `/${expense.id}`, { ...rent, amount: 62000 });
    expect(put.status).toBe(200);
    expect((await (await call('GET', week)).json()).totalKopecks).toBe(1_400_000);

    const removed = await call('DELETE', `/${expense.id}`);
    expect((await removed.json()).expenses).toEqual([]);
    expect((await (await call('GET', week)).json()).totalKopecks).toBe(0);
  });

  it('400 INVALID_EXPENSE с полем; 404 на чужой или несуществующей записи', async () => {
    await boot();
    const bad = await call('POST', '', { ...rent, fromDay: '2026-02-30' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: INVALID_EXPENSE, field: 'fromDay' });

    const period = await call('GET', '/allocation?from=2026-10-31&to=2026-10-01');
    expect(period.status).toBe(400);
    expect(await period.json()).toMatchObject({ code: INVALID_EXPENSE, field: 'period' });

    const foreign = await new FinanceExpenseRepository(pg.db).create('333', {
      kind: 'one_off',
      category: 'other',
      amountKopecks: 100,
      fromDay: '2026-10-01',
      toDay: null,
      note: null,
    });
    for (const [method, path] of [
      ['PUT', `/${foreign.id}`],
      ['DELETE', `/${foreign.id}`],
      ['DELETE', '/not-a-uuid'],
    ] as const) {
      const response = await call(method, path, rent);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe(EXPENSE_NOT_FOUND);
    }
  });

  it('своя категория: появляется в списке, занятая — 409 CATEGORY_IN_USE', async () => {
    await boot();
    const added = await (await call('POST', '/categories', { name: 'Реклама у блогеров' })).json();
    const custom = added.categories.find((c: { custom: boolean }) => c.custom);
    expect(custom).toMatchObject({ label: 'Реклама у блогеров', custom: true });

    const duplicate = await call('POST', '/categories', { name: 'аренда' });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ code: INVALID_EXPENSE, field: 'name' });

    const withCustom = await (
      await call('POST', '', { ...rent, kind: 'one_off', category: custom.key, amount: 5000 })
    ).json();
    expect(withCustom.expenses[0].categoryLabel).toBe('Реклама у блогеров');

    const busy = await call('DELETE', `/categories/${custom.key}`);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: CATEGORY_IN_USE, used: 1 });

    await call('DELETE', `/${withCustom.expenses[0].id}`);
    const freed = await call('DELETE', `/categories/${custom.key}`);
    expect(freed.status).toBe(200);
    expect((await freed.json()).categories.some((c: { custom: boolean }) => c.custom)).toBe(false);
  });
});
