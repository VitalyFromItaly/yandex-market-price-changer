import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

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
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmSettingsController } from '../../src/modules/crm/settings/crm-settings.controller';
import {
  INVALID_SETTING,
  parsePromoBody,
} from '../../src/modules/crm/settings/crm-settings.domain';
import { settingsText } from '../../src/modules/telegram/bots/price-changer-bot/settings.text';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { discountsOf, ratesOf } from '../../src/modules/yandex/reports/profit';
import { promoConfigsOf } from '../../src/modules/yandex/reports/promo';
import { StoreSettingsService } from '../../src/modules/yandex/settings/store-settings.service';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

/**
 * «Настройки» CRM на настоящем HTTP: гвард, коды ошибок и то, что запись
 * попадает в тот же документ, который читает бот.
 */
describe('CRM «Настройки» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let stores: ReturnType<typeof inMemoryModel>;
  let base: string;
  let token: string;

  async function boot(features: Record<string, boolean> = {}) {
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

    // Контроллер и сервис напрямую, без YandexModule: тому нужен весь клиент
    // Partner API, а здесь проверяется только запись настроек.
    @Module({
      imports: [CrmModule],
      controllers: [CrmSettingsController],
      providers: [StoreSettingsService],
    })
    class SettingsTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [SettingsTestModule] })
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
    return fetch(`${base}/api/crm/ym/settings${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  it('GET: действующие ставки и бренды из прайса; ни токена, ни идентификаторов', async () => {
    await boot();
    const response = await call('GET', '');
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('12345678');
    expect(text).not.toContain('87654321');

    const view = JSON.parse(text);
    expect(view).toMatchObject({ commissionPercent: 23, discountPercent: 10, otherCount: 1 });
    expect(view.brands).toEqual([{ key: 'casio', title: 'CASIO', count: 1, discountPercent: 10 }]);
    expect(view.promotion).toEqual([
      { key: 'casio', title: 'CASIO', count: 1, config: null, label: '—' },
    ]);
  });

  it('PUT: правка из CRM видна боту — тот же документ, тот же экран настроек', async () => {
    await boot();
    const response = await call('PUT', '', { commissionPercent: 25, brandDiscounts: { casio: 5 } });
    expect(response.status).toBe(200);

    const store = stores.documents[0];
    expect(ratesOf(store).commissionPercent).toBe(25);
    expect(discountsOf(store).brandPercents.casio).toBe(5);
    expect(settingsText(store as never)).toContain('25%');
  });

  it('PUT: неверное значение — 400 с полем, в базу не пишется', async () => {
    await boot();
    const response = await call('PUT', '', { commissionPercent: 25, taxPercent: 'много' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: INVALID_SETTING, field: 'taxPercent' });
    expect(stores.documents[0].commissionPercent).toBe(23);
  });

  it('промо по ценам с порогом; ноль в пороге не хранится', async () => {
    await boot();
    const tiered = await call('PUT', '/promotion/casio', {
      mode: 'tiered',
      limit: 10000,
      below: 2,
      above: 1,
      from: 3000,
    });
    expect(tiered.status).toBe(200);
    expect(promoConfigsOf(stores.documents[0].promoCommissions).casio).toEqual({
      mode: 'tiered',
      limit: 10000,
      below: 2,
      above: 1,
      from: 3000,
    });

    await call('PUT', '/promotion/casio', { mode: 'flat', percent: 2, from: 0 });
    expect(stores.documents[0].promoCommissions.casio).toEqual({ mode: 'flat', percent: 2 });

    const off = await call('DELETE', '/promotion/casio');
    expect(off.status).toBe(200);
    expect(stores.documents[0].promoCommissions.casio).toBeUndefined();
  });

  it('закрытая promotion: блока нет, запись — 403', async () => {
    await boot({ [FEATURE.PROMOTION]: false });

    const view = (await (await call('GET', '')).json()) as { promotion: unknown };
    expect(view.promotion).toBeNull();

    const response = await call('PUT', '/promotion/casio', { mode: 'flat', percent: 2 });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    expect(stores.documents[0].promoCommissions).toBeUndefined();

    // Остальной раздел открыт: ставки при закрытом продвижении правятся.
    expect((await call('PUT', '', { taxPercent: 6 })).status).toBe(200);
  });
});

describe('parsePromoBody', () => {
  it('строки с запятой — числа, нечисло — NaN (ошибку формулирует общая проверка)', () => {
    expect(parsePromoBody({ mode: 'flat', percent: '2,5' })).toEqual({
      mode: 'flat',
      percent: 2.5,
      from: undefined,
    });
    expect(Number.isNaN((parsePromoBody({ mode: 'flat', percent: 'x' }) as never)['percent'])).toBe(
      true,
    );
  });
});
