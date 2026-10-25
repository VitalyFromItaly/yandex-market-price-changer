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
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmMarketplacesController } from '../../src/modules/crm/marketplaces/crm-marketplaces.controller';
import { CrmOzonController } from '../../src/modules/crm/ozon/crm-ozon.controller';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { MarketplaceConnectionsService } from '../../src/modules/marketplaces/marketplace-connections.service';
import { MarketplaceRegistry } from '../../src/modules/marketplaces/marketplace-registry.service';
import { OzonClientFactory } from '../../src/modules/ozon/ozon-client.factory';
import { OzonConnectionService } from '../../src/modules/ozon/ozon-connection.service';
import {
  OzonAuthError,
  OzonNetworkError,
  OzonServerError,
} from '../../src/modules/ozon/ozon.errors';
import { inMemoryModel } from '../helpers/in-memory-model';

const SELLER = '222';
const OLD_CLIENT = '1111111';
const OLD_KEY = 'old-ozon-key-SECRET-0000';
const NEW_CLIENT = '2222222';
const NEW_KEY = 'new-ozon-key-SECRET-9999';

const ROLES = { roles: [{ name: 'Admin read only', methods: ['/v1/roles'] }], expiresAt: null };

/**
 * PUT /api/crm/ozon/connection на настоящем HTTP (обвязка marketplaces.test):
 * ключ проверяется у Ozon (клиент подменён) ДО записи, отказ не трогает рабочий
 * ключ, ответ не несёт ни ключа, ни Client-Id.
 */
describe('CRM PUT /api/crm/ozon/connection', { timeout: 60_000 }, () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  async function boot(options: { features?: Record<string, boolean>; existing?: boolean } = {}) {
    const { features = { ozon: true }, existing = true } = options;
    const access = inMemoryModel([
      { telegramUserId: SELLER, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');
    const connections = inMemoryModel(
      existing
        ? [
            {
              telegramUserId: SELLER,
              marketplace: 'ozon',
              credentials: { clientId: OLD_CLIENT, apiKey: OLD_KEY },
              status: 'ok',
              accounts: [{ id: OLD_CLIENT, name: '' }],
            },
          ]
        : [],
    );
    const roles = vi.fn();
    const forCredentials = vi.fn(() => ({ roles }));
    const report = vi.fn().mockResolvedValue(undefined);

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
        {
          provide: getModelToken(YandexMarket.name),
          // Магазин ЯМ — для сценариев, где у продавца есть и ЯМ, и Ozon.
          useValue: inMemoryModel([
            {
              telegramUserId: SELLER,
              token: 'ACMA:YM-TOKEN',
              campaign_id: '148655119',
              business_id: '164225008',
            },
          ]),
        },
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
      controllers: [CrmOzonController, CrmMarketplacesController],
      providers: [
        OzonConnectionService,
        MarketplaceConnectionsService,
        { provide: OzonClientFactory, useValue: { forCredentials } },
        {
          provide: MarketplaceRegistry,
          useValue: { supported: () => ['ym'], connectable: () => ['ozon'] },
        },
      ],
    })
    class OzonTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [OzonTestModule] })
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

    const put = (body: unknown) =>
      fetch(`${base}/api/crm/ozon/connection`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const stored = async () =>
      (await connections.findOne({ telegramUserId: SELLER, marketplace: 'ozon' }).exec()) as {
        credentials: Record<string, string>;
        status: string;
      } | null;
    return { base, token, put, stored, roles, forCredentials, report };
  }

  const expectNoSecrets = (text: string) => {
    for (const secret of [OLD_KEY, NEW_KEY, OLD_CLIENT, NEW_CLIENT, 'apiKey', 'credentials']) {
      expect(text).not.toContain(secret);
    }
  };

  it('рабочий ключ: проверен у Ozon, записан, ответ — вид площадки без секретов', async () => {
    const { put, stored, roles, forCredentials } = await boot({ existing: false });
    roles.mockResolvedValue(ROLES);

    const response = await put({ clientId: ` ${NEW_CLIENT} `, apiKey: NEW_KEY });
    expect(response.status).toBe(200);
    const text = await response.text();
    expectNoSecrets(text);
    expect(JSON.parse(text)).toEqual({
      connection: {
        key: 'ozon',
        label: 'Ozon',
        connected: true,
        status: 'ok',
        accountCount: 1,
        available: true,
      },
    });
    expect(forCredentials).toHaveBeenCalledWith({ clientId: NEW_CLIENT, apiKey: NEW_KEY });
    expect(await stored()).toMatchObject({
      credentials: { clientId: NEW_CLIENT, apiKey: NEW_KEY },
      status: 'ok',
    });
  });

  it('Ozon отверг ключ — 400 OZON_KEY_REJECTED, рабочий ключ не тронут, без алерта', async () => {
    const { put, stored, roles, report } = await boot();
    roles.mockRejectedValue(new OzonAuthError('Invalid Api-Key', 401, '16'));

    const response = await put({ clientId: NEW_CLIENT, apiKey: NEW_KEY });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; field: string; message: string };
    expect(body).toMatchObject({ code: 'OZON_KEY_REJECTED', field: 'apiKey' });
    expect(body.message).toContain('Ozon не принял ключ');
    expect(await stored()).toMatchObject({
      credentials: { clientId: OLD_CLIENT, apiKey: OLD_KEY },
      status: 'ok',
    });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ alert: false }));
  });

  it('ключ без ролей — 400 OZON_KEY_EMPTY; Ozon недоступен — 503 OZON_UNAVAILABLE', async () => {
    const { put, stored, roles, report } = await boot();

    roles.mockResolvedValue({ roles: [], expiresAt: null });
    const empty = await put({ clientId: NEW_CLIENT, apiKey: NEW_KEY });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: 'OZON_KEY_EMPTY' });

    for (const error of [new OzonNetworkError('ETIMEDOUT'), new OzonServerError('boom', 502)]) {
      roles.mockRejectedValue(error);
      const down = await put({ clientId: NEW_CLIENT, apiKey: NEW_KEY });
      expect(down.status).toBe(503);
      expect(await down.json()).toMatchObject({ code: 'OZON_UNAVAILABLE' });
    }
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ alert: true }));
    expect(await stored()).toMatchObject({ credentials: { apiKey: OLD_KEY } });
  });

  it('неверный формат — 400 INVALID_OZON_KEY под полем, до Ozon не доходит', async () => {
    const { put, forCredentials } = await boot();
    const response = await put({ clientId: 'abc', apiKey: NEW_KEY });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_OZON_KEY', field: 'clientId' });
    expect(forCredentials).not.toHaveBeenCalled();
  });

  it('фича ozon закрыта — 403 FEATURE_DISABLED, Ozon не спрашивается', async () => {
    const { put, forCredentials } = await boot({ features: {} });
    const response = await put({ clientId: NEW_CLIENT, apiKey: NEW_KEY });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(forCredentials).not.toHaveBeenCalled();
  });

  it('после подключения GET /marketplaces — Ozon подключён, ключа в ответе нет', async () => {
    const { base, token, put, roles } = await boot({ existing: false });
    roles.mockResolvedValue(ROLES);
    expect((await put({ clientId: NEW_CLIENT, apiKey: NEW_KEY })).status).toBe(200);

    const response = await fetch(`${base}/api/crm/marketplaces`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    expectNoSecrets(text);
    expect(JSON.parse(text).marketplaces[1]).toMatchObject({
      key: 'ozon',
      connected: true,
      available: true,
    });
  });
});
