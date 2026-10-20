import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
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
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { CrmConnectionsController } from '../../src/modules/crm/connections/crm-connections.controller';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmWbController } from '../../src/modules/crm/wb/crm-wb.controller';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import {
  connectionCards,
  maskKeyHint,
} from '../../src/modules/marketplaces/marketplace-connections.domain';
import { MarketplaceConnectionsService } from '../../src/modules/marketplaces/marketplace-connections.service';
import { MarketplaceRegistry } from '../../src/modules/marketplaces/marketplace-registry.service';
import { YmConnectionAdapter } from '../../src/modules/marketplaces/ym-connection.adapter';
import { YmMarketplaceAdapter } from '../../src/modules/marketplaces/ym-marketplace.adapter';
import { OzonClientFactory } from '../../src/modules/ozon/ozon-client.factory';
import { OzonCatalogService } from '../../src/modules/ozon/ozon-catalog.service';
import { OzonConnectionService } from '../../src/modules/ozon/ozon-connection.service';
import { OzonFinanceService } from '../../src/modules/ozon/ozon-finance.service';
import { OzonStockWriteService } from '../../src/modules/ozon/ozon-stock-write.service';
import { OzonOrdersService } from '../../src/modules/ozon/ozon-orders.service';
import { OzonMarketplaceAdapter } from '../../src/modules/ozon/ozon-marketplace.adapter';
import { OzonAuthError, OzonNetworkError } from '../../src/modules/ozon/ozon.errors';
import { YandexAuthError } from '../../src/modules/yandex/yandex-api.errors';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { StoresService } from '../../src/modules/yandex/stores/stores.service';
import { WbCatalogService } from '../../src/modules/wb/wb-catalog.service';
import { WbFinanceService } from '../../src/modules/wb/wb-finance.service';
import { WbStockWriteService } from '../../src/modules/wb/wb-stock-write.service';
import { WbConnectionService } from '../../src/modules/wb/wb-connection.service';
import { WbMarketplaceAdapter } from '../../src/modules/wb/wb-marketplace.adapter';
import { WbOrdersService } from '../../src/modules/wb/wb-orders.service';
import { WbClientFactory } from '../../src/modules/wb/wb-client.factory';
import { WbAuthError, WbServerError } from '../../src/modules/wb/wb.errors';
import { inMemoryModel } from '../helpers/in-memory-model';

const SELLER = '222';
const YM_TOKEN = 'ACMA:YM-TOKEN-SECRET-abcd1234';
const OZON_CLIENT = '1111111';
const OZON_KEY = 'ozon-key-SECRET-00009876';

const STORE = {
  campaignId: '148655119',
  businessId: '164225008',
  businessName: 'ALL BEST WATCH',
  storeName: 'All Best Watch',
  placementType: 'FBS',
};

describe('maskKeyHint', () => {
  it('последние 4 символа за точками; короткий ключ — одни точки; пусто — null', () => {
    expect(maskKeyHint(YM_TOKEN)).toBe('••••1234');
    expect(maskKeyHint('short-key')).toBe('••••');
    expect(maskKeyHint('  ')).toBeNull();
    expect(maskKeyHint(undefined)).toBeNull();
  });
});

describe('connectionCards', () => {
  it('ЯМ: маска, магазины подписью «Имя · модель», дата проверки; Ozon без фичи — «скоро»', () => {
    const cards = connectionCards(
      {
        token: YM_TOKEN,
        campaign_id: STORE.campaignId,
        business_id: STORE.businessId,
        stores: [STORE],
        tokenCheckedAt: new Date('2026-10-18T08:00:00Z'),
      },
      [],
      ['ym'],
    );
    expect(cards.map((card) => card.key)).toEqual(['ym', 'ozon', 'wb']);
    expect(cards[0]).toMatchObject({
      connected: true,
      keyHint: '••••1234',
      checkedAt: '2026-10-18T08:00:00.000Z',
      accounts: ['All Best Watch · FBS'],
    });
    expect(cards[1]).toMatchObject({ available: false, connected: false, keyHint: null });
  });
});

/**
 * GET /api/crm/connections и POST /:marketplace/check на настоящем HTTP
 * (обвязка crm-ozon.test): карточки без ключей, повторная проверка не меняет
 * ключ ни в одном исходе, Ozon закрыт своей фичей.
 */
describe('CRM /api/crm/connections', { timeout: 60_000 }, () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  async function boot(options: { features?: Record<string, boolean>; ozon?: boolean } = {}) {
    const { features = { ozon: true }, ozon = true } = options;
    const access = inMemoryModel([
      { telegramUserId: SELLER, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');
    const ym = inMemoryModel([
      {
        telegramUserId: SELLER,
        token: YM_TOKEN,
        campaign_id: STORE.campaignId,
        business_id: STORE.businessId,
        stores: [STORE],
      },
    ]);
    const connections = inMemoryModel(
      ozon
        ? [
            {
              telegramUserId: SELLER,
              marketplace: 'ozon',
              credentials: { clientId: OZON_CLIENT, apiKey: OZON_KEY },
              status: 'ok',
              accounts: [{ id: OZON_CLIENT, name: '' }],
            },
          ]
        : [],
    );
    const roles = vi.fn();
    const forCredentials = vi.fn(() => ({ roles }));
    const listStores = vi.fn();
    const forTokenOnly = vi.fn(() => ({ listStores }));
    const report = vi.fn().mockResolvedValue(undefined);
    const ping = vi.fn().mockResolvedValue(undefined);
    const sellerInfo = vi
      .fn()
      .mockResolvedValue({ name: 'ИП Иванов', sid: 'wb-sid', tradeMark: '' });
    const forToken = vi.fn(() => ({ ping, sellerInfo }));

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: ym },
        { provide: getModelToken(MarketplaceConnection.name), useValue: connections },
        { provide: ErrorReporter, useValue: { report } },
        {
          provide: AppConfigService,
          useValue: { isAdmin: () => false, crmInitialPassword: 'tg_rules_2026' },
        },
      ],
      exports: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        ErrorReporter,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmConnectionsController, CrmWbController],
      providers: [
        OzonConnectionService,
        OzonCatalogService,
        OzonOrdersService,
        // Финансы Ozon (TASK-131) проверке подключения не нужны: тянут Postgres.
        { provide: OzonFinanceService, useValue: {} },
        { provide: OzonStockWriteService, useValue: {} },
        StoresService,
        MarketplaceConnectionsService,
        { provide: OzonClientFactory, useValue: { forCredentials } },
        { provide: YandexClientFactory, useValue: { forTokenOnly } },
        WbConnectionService,
        WbCatalogService,
        WbOrdersService,
        { provide: WbFinanceService, useValue: {} },
        { provide: WbStockWriteService, useValue: {} },
        { provide: WbClientFactory, useValue: { forToken } },
        // Настоящий реестр с настоящими адаптерами подключения (TASK-162): проверка
        // идёт тем же путём, что в проде. Данные ЯМ этому тесту не нужны.
        { provide: YmMarketplaceAdapter, useValue: { marketplace: 'ym' } },
        YmConnectionAdapter,
        OzonMarketplaceAdapter,
        WbMarketplaceAdapter,
        MarketplaceRegistry,
      ],
    })
    class ConnectionsTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ConnectionsTestModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    const base = (await app.getUrl()).replace('[::1]', 'localhost');

    const login = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'vasya', password: 'tg_rules_2026' }),
    });
    const first = ((await login.json()) as { token: string }).token;
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: 'tg_rules_2026', next: 'my-own-password' }),
    });
    const token = ((await change.json()) as { token: string }).token;
    const auth = { authorization: `Bearer ${token}` };

    const list = () => fetch(`${base}/api/crm/connections`, { headers: auth });
    const putWb = (body: unknown) =>
      fetch(`${base}/api/crm/wb/connection`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const check = (marketplace: string) =>
      fetch(`${base}/api/crm/connections/${marketplace}/check`, { method: 'POST', headers: auth });
    const ymDoc = async () =>
      (await ym.findOne({ telegramUserId: SELLER }).exec()) as Record<string, unknown>;
    const ozonDoc = async () =>
      (await connections.findOne({ telegramUserId: SELLER, marketplace: 'ozon' }).exec()) as Record<
        string,
        unknown
      >;
    const wbDoc = async () =>
      (await connections.findOne({ telegramUserId: SELLER, marketplace: 'wb' }).exec()) as Record<
        string,
        unknown
      > | null;
    return {
      list,
      check,
      putWb,
      ymDoc,
      ozonDoc,
      wbDoc,
      roles,
      forCredentials,
      listStores,
      forTokenOnly,
      ping,
      forToken,
    };
  }

  const expectNoSecrets = (text: string) => {
    for (const secret of [YM_TOKEN, OZON_KEY, OZON_CLIENT, 'apiKey', 'credentials']) {
      expect(text).not.toContain(secret);
    }
    // campaign_id/business_id продавцу не печатаются нигде.
    expect(text).not.toContain(STORE.campaignId);
    expect(text).not.toContain(STORE.businessId);
  };

  it('GET — три карточки с масками, без ключей и id', async () => {
    const { list } = await boot();
    const response = await list();
    expect(response.status).toBe(200);
    const text = await response.text();
    expectNoSecrets(text);
    const { connections } = JSON.parse(text) as { connections: Array<Record<string, unknown>> };
    expect(connections.map((card) => card.key)).toEqual(['ym', 'ozon', 'wb']);
    expect(connections[0]).toMatchObject({ connected: true, keyHint: '••••1234' });
    expect(connections[1]).toMatchObject({
      connected: true,
      available: true,
      keyHint: '••••9876',
      accounts: ['кабинет без названия'],
    });
    expect(connections[2]).toMatchObject({ available: false, connected: false });
  });

  it('проверка ЯМ: связь есть — обновлены кэш и дата, токен тот же', async () => {
    const { check, ymDoc, listStores, forTokenOnly } = await boot();
    listStores.mockResolvedValue([STORE, { ...STORE, campaignId: '1', storeName: 'Второй' }]);

    const response = await check('ym');
    expect(response.status).toBe(200);
    const text = await response.text();
    expectNoSecrets(text);
    const body = JSON.parse(text);
    expect(body.check.status).toBe('ok');
    expect(body.connection.checkedAt).toEqual(expect.any(String));
    expect(body.connection.accounts).toEqual(['All Best Watch · FBS', 'Второй · FBS']);
    expect(forTokenOnly).toHaveBeenCalledWith(YM_TOKEN);
    const doc = await ymDoc();
    expect(doc.token).toBe(YM_TOKEN);
    expect(doc.campaign_id).toBe(STORE.campaignId);
    expect(doc.tokenCheckedAt).toBeInstanceOf(Date);
  });

  it('проверка ЯМ: отказ и недоступность — 200 с итогом, ничего не записано', async () => {
    const { check, ymDoc, listStores } = await boot();

    listStores.mockRejectedValue(new YandexAuthError('Unauthorized', 401));
    const rejected = await (await check('ym')).json();
    expect(rejected.check.status).toBe('rejected');

    listStores.mockRejectedValue(new Error('ETIMEDOUT'));
    const down = await (await check('ym')).json();
    expect(down.check).toMatchObject({ status: 'unavailable' });
    expect(down.check.message).toContain('Ключ остался прежним');

    const doc = await ymDoc();
    expect(doc.token).toBe(YM_TOKEN);
    expect(doc.tokenCheckedAt).toBeUndefined();
  });

  it('проверка Ozon: отказ пишет статус и текст, ключ тот же; недоступность статус не трогает', async () => {
    const { check, ozonDoc, roles, forCredentials } = await boot();

    roles.mockRejectedValue(new OzonNetworkError('ETIMEDOUT'));
    const down = await (await check('ozon')).json();
    expect(down.check.status).toBe('unavailable');
    expect((await ozonDoc()).status).toBe('ok');

    roles.mockRejectedValue(new OzonAuthError('Invalid Api-Key', 401, '16'));
    const response = await check('ozon');
    const text = await response.text();
    expectNoSecrets(text);
    const body = JSON.parse(text);
    expect(body.check.status).toBe('rejected');
    expect(body.connection).toMatchObject({ status: 'rejected', connected: false });
    expect(body.connection.checkError).toContain('Ozon не принял ключ');
    expect(forCredentials).toHaveBeenCalledWith({ clientId: OZON_CLIENT, apiKey: OZON_KEY });
    expect(await ozonDoc()).toMatchObject({
      status: 'rejected',
      credentials: { clientId: OZON_CLIENT, apiKey: OZON_KEY },
    });

    roles.mockResolvedValue({ roles: [{ name: 'Admin', methods: [] }], expiresAt: null });
    const ok = await (await check('ozon')).json();
    expect(ok.connection).toMatchObject({ status: 'ok', connected: true, checkError: null });
  });

  it('Ozon без фичи — 403 FEATURE_DISABLED, Ozon не спрашивается; не подключён — 404', async () => {
    const closed = await boot({ features: {} });
    const refused = await closed.check('ozon');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(closed.forCredentials).not.toHaveBeenCalled();
    await app.close();

    const empty = await boot({ ozon: false });
    const missing = await empty.check('ozon');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('незнакомая площадка — 400 UNKNOWN_MARKETPLACE', async () => {
    const { check } = await boot();
    const response = await check('amazon');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'UNKNOWN_MARKETPLACE' });
  });

  const WB_TOKEN = `${Buffer.from('{"alg":"ES256"}').toString('base64url')}.${Buffer.from(
    JSON.stringify({ exp: 4_102_444_800 }),
  ).toString('base64url')}.WB-SECRET-signature-0000abcd`;

  it('WB: токен проверен по категориям и записан; карточка — маска и кабинет, без токена', async () => {
    const { putWb, list, wbDoc, ping, forToken } = await boot({ features: { wb: true } });
    const response = await putWb({ token: ` ${WB_TOKEN} ` });
    expect(response.status).toBe(200);
    expect(forToken).toHaveBeenCalledWith(WB_TOKEN);
    expect(ping.mock.calls.map(([category]) => category)).toEqual([
      'content',
      'marketplace',
      'statistics',
      'analytics',
      'finance',
    ]);
    expect(await wbDoc()).toMatchObject({ status: 'ok', credentials: { token: WB_TOKEN } });

    const text = await (await list()).text();
    expect(text).not.toContain(WB_TOKEN);
    expect(text).not.toContain('wb-sid');
    const wb = JSON.parse(text).connections[2];
    expect(wb).toMatchObject({
      key: 'wb',
      connected: true,
      available: true,
      keyHint: '••••abcd',
      accounts: ['ИП Иванов'],
    });
  });

  it('WB: нет категории — 400 WB_TOKEN_SCOPES с перечнем, ничего не записано', async () => {
    const { putWb, wbDoc, ping } = await boot({ features: { wb: true } });
    ping.mockImplementation(async (category: string) => {
      if (category === 'finance') throw new WbAuthError('scope', 401);
    });
    const response = await putWb({ token: WB_TOKEN });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; field: string; message: string };
    expect(body).toMatchObject({ code: 'WB_TOKEN_SCOPES', field: 'token' });
    expect(body.message).toContain('«Финансы»');
    expect(await wbDoc()).toBeNull();
  });

  it('WB: мусор — 400 INVALID_WB_TOKEN до WB; WB лежит — 503; фича закрыта — 403', async () => {
    const open = await boot({ features: { wb: true } });
    const garbage = await open.putWb({ token: 'not-a-token' });
    expect(garbage.status).toBe(400);
    expect(await garbage.json()).toMatchObject({ code: 'INVALID_WB_TOKEN' });
    expect(open.forToken).not.toHaveBeenCalled();

    open.ping.mockRejectedValue(new WbServerError('boom', 502));
    const down = await open.putWb({ token: WB_TOKEN });
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ code: 'WB_UNAVAILABLE' });
    await app.close();

    const closed = await boot({ features: {} });
    expect((await closed.putWb({ token: WB_TOKEN })).status).toBe(403);
    const refused = await closed.check('wb');
    expect(refused.status).toBe(403);
    expect(closed.forToken).not.toHaveBeenCalled();
  });

  it('WB: «проверить связь» — отказ пишет статус, токен тот же', async () => {
    const { putWb, check, wbDoc, ping } = await boot({ features: { wb: true } });
    expect((await putWb({ token: WB_TOKEN })).status).toBe(200);

    ping.mockRejectedValue(new WbAuthError('revoked', 401));
    const body = await (await check('wb')).json();
    expect(body.check.status).toBe('rejected');
    expect(body.connection).toMatchObject({ status: 'rejected', connected: false });
    expect(await wbDoc()).toMatchObject({ status: 'rejected', credentials: { token: WB_TOKEN } });
  });
});
