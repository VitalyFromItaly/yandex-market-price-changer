import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmStoresController } from '../../src/modules/crm/stores/crm-stores.controller';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { storeKeyOf } from '../../src/modules/yandex/stores/stores.domain';
import { StoresService } from '../../src/modules/yandex/stores/stores.service';
import { YandexAuthError, YandexNetworkError } from '../../src/modules/yandex/yandex-api.errors';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';
const OLD_TOKEN = 'ACMA:OLD-SECRET-TOKEN';
const NEW_TOKEN = 'ACMA:NEW-SECRET-TOKEN';

const FBS = {
  campaignId: '148655119',
  businessId: '164225008',
  businessName: 'SBrand',
  storeName: 'Время с SBrand',
  placementType: 'FBS',
};
const FBY = { ...FBS, campaignId: '148704883', placementType: 'FBY' };
const OTHER = {
  campaignId: '555000',
  businessId: '777000',
  businessName: 'Другой',
  storeName: 'other.ru',
  placementType: 'FBS',
};

/**
 * «Магазины» CRM на настоящем HTTP. Главное, что здесь пинится: веб не
 * переключает активный магазин бота, ответы не несут ни токена, ни
 * идентификаторов, а неверный новый токен не ломает подключение.
 */
describe('CRM «Магазины» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let stores: ReturnType<typeof inMemoryModel>;
  let base: string;
  let token: string;
  const listStores = vi.fn();

  async function boot(cached: unknown[] = [FBS, FBY], features: Record<string, boolean> = {}) {
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        campaign_id: FBS.campaignId,
        business_id: FBS.businessId,
        name: FBS.storeName,
        token: OLD_TOKEN,
        stores: cached,
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
        { provide: ErrorReporter, useValue: { report: async () => undefined } },
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
        ErrorReporter,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    // Контроллер и сервис напрямую, без YandexModule: клиент Partner API —
    // подделка, которая отвечает списком магазинов по токену.
    @Module({
      imports: [CrmModule],
      controllers: [CrmStoresController],
      providers: [
        StoresService,
        { provide: YandexClientFactory, useValue: { forTokenOnly: () => ({ listStores }) } },
      ],
    })
    class StoresTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [StoresTestModule] })
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
    return fetch(`${base}/api/crm/ym/stores${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const doc = () => stores.documents[0] as Record<string, unknown>;

  beforeEach(() => {
    listStores.mockReset();
  });

  afterEach(async () => {
    await app?.close();
  });

  function expectNoSecrets(text: string) {
    for (const secret of [
      OLD_TOKEN,
      NEW_TOKEN,
      FBS.campaignId,
      FBY.campaignId,
      FBS.businessId,
      OTHER.campaignId,
      OTHER.businessId,
    ]) {
      expect(text).not.toContain(secret);
    }
  }

  it('GET: магазины из кэша, одинаковые имена различаются моделью; без секретов', async () => {
    await boot();
    const response = await call('GET', '');
    expect(response.status).toBe(200);

    const text = await response.text();
    expectNoSecrets(text);
    expect(JSON.parse(text).stores).toEqual([
      {
        key: storeKeyOf(FBS.campaignId),
        label: 'Время с SBrand · FBS',
        businessName: 'SBrand',
        placementType: 'FBS',
      },
      {
        key: storeKeyOf(FBY.campaignId),
        label: 'Время с SBrand · FBY',
        businessName: 'SBrand',
        placementType: 'FBY',
      },
    ]);
    // Кэш заполнен — Маркет не спрашивали.
    expect(listStores).not.toHaveBeenCalled();
  });

  it('GET: пустой кэш добирается одним запросом и сохраняется', async () => {
    listStores.mockResolvedValue([FBS, OTHER]);
    await boot([]);
    const view = (await (await call('GET', '')).json()) as { stores: unknown[] };

    expect(view.stores).toHaveLength(2);
    expect(doc().stores).toEqual([FBS, OTHER]);
    // Активный магазин бота при этом не тронут.
    expect(doc().campaign_id).toBe(FBS.campaignId);
  });

  it('GET /:key — разделы по модели ЭТОГО магазина; открытие не переключает бота', async () => {
    await boot([FBS, FBY], { [FEATURE.REPORT_PROFIT]: false });

    const fby = await call('GET', `/${storeKeyOf(FBY.campaignId)}`);
    expect(fby.status).toBe(200);
    const text = await fby.text();
    expectNoSecrets(text);
    const view = JSON.parse(text) as { label: string; placementType: string; sections: string[] };
    expect(view).toMatchObject({ label: 'Время с SBrand · FBY', placementType: 'FBY' });
    expect(view.sections).toEqual(expect.arrayContaining(['ym-dashboard', 'ym-orders']));
    expect(view.sections).not.toContain('ym-profit');
    // Разделы аккаунта здесь не повторяются.
    expect(view.sections).not.toContain('ym-settings');

    expect(doc().campaign_id).toBe(FBS.campaignId);
  });

  it('GET /:key чужого магазина → 404 STORE_NOT_FOUND', async () => {
    await boot();
    const response = await call('GET', `/${storeKeyOf(OTHER.campaignId)}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'STORE_NOT_FOUND' });
  });

  describe('PUT /token', () => {
    it('Маркет отклонил токен → 400 TOKEN_REJECTED, прежний токен на месте', async () => {
      listStores.mockRejectedValue(new YandexAuthError('unauthorized', 401));
      await boot();
      const response = await call('PUT', '/token', { token: NEW_TOKEN });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { code: string; message: string };
      expect(body.code).toBe('TOKEN_REJECTED');
      expect(body.message).toContain('отклонил ваш API-токен');
      expect(doc().token).toBe(OLD_TOKEN);
    });

    it('Маркет недоступен → 503, а не «неверный токен»; ничего не пишется', async () => {
      listStores.mockRejectedValue(new YandexNetworkError('ECONNRESET'));
      await boot();
      const response = await call('PUT', '/token', { token: NEW_TOKEN });

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'MARKET_UNAVAILABLE' });
      expect(doc().token).toBe(OLD_TOKEN);
    });

    it('токен без магазинов → 400 TOKEN_EMPTY; кривой формат → 400 INVALID_TOKEN без запроса', async () => {
      listStores.mockResolvedValue([]);
      await boot();

      const empty = await call('PUT', '/token', { token: NEW_TOKEN });
      expect(empty.status).toBe(400);
      expect(await empty.json()).toMatchObject({ code: 'TOKEN_EMPTY' });

      listStores.mockClear();
      const junk = await call('PUT', '/token', { token: 'с пробелами и кириллицей' });
      expect(junk.status).toBe(400);
      expect(await junk.json()).toMatchObject({ code: 'INVALID_TOKEN' });
      expect(listStores).not.toHaveBeenCalled();
      expect(doc().token).toBe(OLD_TOKEN);
    });

    it('перевыпуск того же кабинета: токен и кэш обновлены, бот остался на своём магазине', async () => {
      listStores.mockResolvedValue([FBY, FBS]);
      await boot([FBS]);
      const response = await call('PUT', '/token', { token: NEW_TOKEN });

      expect(response.status).toBe(200);
      const text = await response.text();
      expectNoSecrets(text);
      expect(JSON.parse(text)).toMatchObject({ botStore: null });
      expect(doc()).toMatchObject({ token: NEW_TOKEN, campaign_id: FBS.campaignId });
      expect(doc().stores).toEqual([FBY, FBS]);
    });

    it('токен другого кабинета: в боте активным стал первый магазин, ответ его называет', async () => {
      listStores.mockResolvedValue([OTHER]);
      await boot();
      const response = await call('PUT', '/token', { token: NEW_TOKEN });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ botStore: 'other.ru · FBS' });
      expect(doc()).toMatchObject({
        token: NEW_TOKEN,
        campaign_id: OTHER.campaignId,
        business_id: OTHER.businessId,
        name: OTHER.storeName,
      });
    });
  });
});
