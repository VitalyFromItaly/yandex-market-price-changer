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
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceTaxYearRepository } from '../../src/database/postgres/repositories/finance-tax-year.repository';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmTaxesController } from '../../src/modules/crm/taxes/crm-taxes.controller';
import {
  INVALID_TAX_SETTING,
  INVALID_TAX_YEAR_INPUT,
  TAX_REDUCTION_NOT_FOUND,
} from '../../src/modules/crm/taxes/crm-taxes.domain';
import { FinanceTaxYearDataService } from '../../src/modules/finance/finance-tax-year-data.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb, type ITestFinanceDb } from '../helpers/test-postgres';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

/**
 * «Налоги» CRM на настоящем HTTP: гейт фичи, умолчание без записи, 400 с
 * полем и запись в Postgres (PGlite).
 */
describe('CRM «Налоги» по HTTP', { timeout: 60_000 }, () => {
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

  async function boot(features: Record<string, boolean> = { [FEATURE.TAXES]: true }) {
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
      controllers: [CrmTaxesController],
      providers: [
        FinanceTaxService,
        FinanceTaxYearDataService,
        {
          provide: FinanceTaxSettingsRepository,
          useValue: new FinanceTaxSettingsRepository(pg.db),
        },
        { provide: FinanceTaxYearRepository, useValue: new FinanceTaxYearRepository(pg.db) },
      ],
    })
    class TaxesTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TaxesTestModule] })
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
    return fetch(`${base}/api/crm/ym/taxes${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  const repository = () => new FinanceTaxSettingsRepository(pg.db);

  it('фича выключена — 403 FEATURE_DISABLED на чтении и записи, в базу ничего не попало', async () => {
    await boot({});
    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', { regime: 'usn_income', rate: '6', recognition: 'payment' }],
    ] as const) {
      const response = await call(method, '', body);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    }
    expect(await repository().find(SELLER_ID)).toBeNull();
  });

  it('GET без записи: УСН «Доходы» 6 %, по поступлению, isDefault; без telegramUserId', async () => {
    await boot();
    const response = await call('GET', '');
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.settings).toEqual({
      regime: 'usn_income',
      rateBasisPoints: 600,
      recognition: 'payment',
    });
    expect(view.isDefault).toBe(true);
    expect(view.updatedAt).toBeNull();
    expect(view.regimes.filter((r: { selectable: boolean }) => r.selectable)).toHaveLength(2);
    expect(view.minimumTaxBasisPoints).toBe(100);
    expect(JSON.stringify(view)).not.toContain(SELLER_ID);
  });

  it('PUT пишет в Postgres и отвечает сохранённым видом', async () => {
    await boot();
    const response = await call('PUT', '', {
      regime: 'usn_income_minus_expenses',
      recognition: 'realization',
    });
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.settings).toEqual({
      regime: 'usn_income_minus_expenses',
      rateBasisPoints: 1500,
      recognition: 'realization',
    });
    expect(view.isDefault).toBe(false);
    expect(await repository().find(SELLER_ID)).toMatchObject({ rateBasisPoints: 1500 });

    const reread = await (await call('GET', '')).json();
    expect(reread.settings.regime).toBe('usn_income_minus_expenses');
  });

  it('ошибка ввода — 400 INVALID_TAX_SETTING с полем, запись не изменилась', async () => {
    await boot();
    for (const [body, field] of [
      [{ rate: '7' }, 'rate'],
      [{ regime: 'osno' }, 'regime'],
      [{ recognition: 'never' }, 'recognition'],
    ] as const) {
      const response = await call('PUT', '', body);
      expect(response.status).toBe(400);
      const error = (await response.json()) as { code: string; field: string; message: string };
      expect(error.code).toBe(INVALID_TAX_SETTING);
      expect(error.field).toBe(field);
      expect(error.message.length).toBeGreaterThan(0);
    }
    expect(await repository().find(SELLER_ID)).toBeNull();
  });

  describe('вкладка «Год» (TASK-146)', () => {
    const YEAR_FEATURES = {
      [FEATURE.TAXES]: true,
      [FEATURE.TAX_YEAR]: true,
      [FEATURE.FINANCE]: true,
    };
    const thisYear = Number(new Date().toISOString().slice(0, 4));

    it('tax_year закрыта (или закрыта finance) — 403 на маршрутах вкладки, настройки открыты', async () => {
      for (const features of [
        { [FEATURE.TAXES]: true },
        { [FEATURE.TAXES]: true, [FEATURE.TAX_YEAR]: true },
      ]) {
        await boot(features);
        for (const [method, path, body] of [
          ['GET', '/reductions', undefined],
          ['POST', '/reductions', { paidDay: '2026-03-01', kind: 'insurance_fixed', amount: '1000' }],
          ['PUT', '/staff', { hasStaff: true }],
          ['PUT', `/reconciliations/${thisYear}/q1`, { checked: true }],
        ] as const) {
          const response = await call(method, path, body);
          expect(response.status).toBe(403);
          expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
        }
        expect((await call('GET', '')).status).toBe(200);
        await app.close();
      }
      expect(await new FinanceTaxYearRepository(pg.db).listReductions(SELLER_ID)).toEqual([]);
    });

    it('уменьшения: создать, исправить, удалить — ответ списком с подписями, без id продавца', async () => {
      await boot(YEAR_FEATURES);
      const created = await call('POST', '/reductions', {
        paidDay: '2026-03-20',
        kind: 'insurance_fixed',
        amount: '57 390',
        note: 'взносы за I кв.',
      });
      expect(created.status).toBe(201);
      const list = await created.json();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        kind: 'insurance_fixed',
        kindLabel: 'Фиксированные взносы ИП',
        amountKopecks: 5_739_000,
      });
      expect(list.kinds.map((k: { key: string }) => k.key)).toEqual([
        'insurance_fixed',
        'insurance_extra',
        'other',
      ]);
      // Значение целиком, в кавычках: голое «222» встречается внутри случайного uuid записи
      // (~0,5 % прогонов) — так тест и мигал (TASK-174).
      expect(JSON.stringify(list)).not.toContain('telegramUserId');
      expect(JSON.stringify(list)).not.toContain(`"${SELLER_ID}"`);

      const id = list.items[0].id as string;
      const updated = await (
        await call('PUT', `/reductions/${id}`, { paidDay: '2026-03-21', kind: 'other', amount: 100 })
      ).json();
      expect(updated.items[0]).toMatchObject({ paidDay: '2026-03-21', kind: 'other', amountKopecks: 10_000 });

      expect((await call('DELETE', `/reductions/${id}`)).status).toBe(200);
      const missing = await call('DELETE', `/reductions/${id}`);
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { code: string }).code).toBe(TAX_REDUCTION_NOT_FOUND);
      expect((await call('PUT', '/reductions/abc', { paidDay: '2026-03-21' })).status).toBe(404);
    });

    it('ошибки ввода — 400 INVALID_TAX_YEAR_INPUT с полем', async () => {
      await boot(YEAR_FEATURES);
      for (const [method, path, body, field] of [
        ['POST', '/reductions', { paidDay: '2026-03-01', kind: 'insurance_fixed', amount: '-5' }, 'amount'],
        ['POST', '/reductions', { paidDay: '2026-03-01', kind: 'bribe', amount: '5' }, 'kind'],
        ['PUT', '/staff', { hasStaff: 'yes' }, 'staff'],
        ['PUT', `/reconciliations/${thisYear}/q5`, { checked: true }, 'period'],
        ['PUT', `/reconciliations/${thisYear}/q1`, { checked: 'да' }, 'checked'],
        ['PUT', `/reconciliations/${thisYear - 10}/q1`, { checked: true }, 'year'],
      ] as const) {
        const response = await call(method, path, body);
        expect(response.status).toBe(400);
        const error = (await response.json()) as { code: string; field: string };
        expect(error.code).toBe(INVALID_TAX_YEAR_INPUT);
        expect(error.field).toBe(field);
      }
    });

    it('сверка и работники пишутся в Postgres; работники не сбрасывают режим', async () => {
      await boot(YEAR_FEATURES);
      await call('PUT', '', { regime: 'usn_income', rate: '4' });
      const staff = await call('PUT', '/staff', { hasStaff: true });
      expect(await staff.json()).toEqual({ hasStaff: true });
      expect(await repository().find(SELLER_ID)).toMatchObject({ hasStaff: true, rateBasisPoints: 400 });
      // Форма режима о работниках не знает и флаг не сбрасывает.
      await call('PUT', '', { rate: '5' });
      expect(await repository().find(SELLER_ID)).toMatchObject({ hasStaff: true, rateBasisPoints: 500 });

      const saved = await call('PUT', `/reconciliations/${thisYear}/h1`, {
        accountantIncome: '1 000 000',
        accountantTax: '60000',
        checked: true,
        note: 'сверено с бухгалтером',
      });
      expect(await saved.json()).toEqual({ ok: true });
      const [row] = await new FinanceTaxYearRepository(pg.db).reconciliations(SELLER_ID, thisYear);
      expect(row).toMatchObject({
        period: 'h1',
        accountantIncomeKopecks: 100_000_000,
        accountantTaxKopecks: 6_000_000,
        checked: true,
      });
      expect(row.checkedAt).toBeInstanceOf(Date);
    });
  });
});
