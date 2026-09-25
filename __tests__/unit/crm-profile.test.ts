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
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmProfileController } from '../../src/modules/crm/profile/crm-profile.controller';
import { helpModel } from '../../src/modules/telegram/bots/price-changer-bot/help.text';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';
const PRICE_DATE = new Date('2026-09-20T09:00:00.000Z');
const REGISTERED = new Date('2026-07-28T10:00:00.000Z');

/**
 * «Профиль» и «Помощь» CRM на настоящем HTTP: гвард, поля из общей с ботом
 * вьюхи и — главное — никаких идентификаторов магазина и токена в ответе.
 */
describe('CRM «Профиль» и «Помощь» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;

  async function boot(opts: { admin?: boolean; features?: Record<string, boolean> } = {}) {
    const access = inMemoryModel(
      opts.admin
        ? []
        : [
            {
              telegramUserId: SELLER_ID,
              botId: '999',
              status: 'approved',
              username: 'Vasya',
              firstName: 'Вася',
              lastName: 'Пупкин',
              features: opts.features ?? {},
              createdAt: REGISTERED,
            },
          ],
    );
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        name: 'Время с SBrand',
        campaign_id: '12345678',
        business_id: '87654321',
        token: 'SECRET-TOKEN',
        stores: [{ campaignId: '12345678', placementType: 'FBS' }],
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
        { provide: PurchasePriceService, useValue: { lastUpdatedAt: async () => PRICE_DATE } },
        {
          provide: AppConfigService,
          useValue: {
            isAdmin: (id: unknown) => Boolean(opts.admin) && String(id) === SELLER_ID,
            crmInitialPassword: INITIAL,
          },
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

    @Module({ imports: [CrmModule], controllers: [CrmProfileController] })
    class ProfileTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ProfileTestModule] })
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
      body: JSON.stringify({ login: opts.admin ? SELLER_ID : 'vasya', password: INITIAL }),
    });
    return ((await login.json()) as { token: string }).token;
  }

  async function changePassword(first: string): Promise<string> {
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    return ((await change.json()) as { token: string }).token;
  }

  function get(path: string, token: string) {
    return fetch(`${base}/api/crm/${path}`, { headers: { authorization: `Bearer ${token}` } });
  }

  afterEach(async () => {
    await app?.close();
  });

  it('до смены стартового пароля оба экрана закрыты', async () => {
    const first = await boot();
    expect((await get('profile', first)).status).toBe(403);
    expect((await get('help', first)).status).toBe(403);
  });

  it('профиль продавца — поля вьюхи бота, без токена и id магазина', async () => {
    const token = await changePassword(
      await boot({ features: { [FEATURE.REPORT_PROFIT]: false } }),
    );
    const response = await get('profile', token);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      telegramUserId: SELLER_ID,
      name: 'Вася Пупкин',
      username: 'Vasya',
      isAdmin: false,
      access: { status: 'approved', label: '✅ Выдан' },
      registeredAt: REGISTERED.toISOString(),
      store: { name: 'Время с SBrand', placementType: 'FBS', configured: true },
      priceListUpdatedAt: PRICE_DATE.toISOString(),
    });
    const keys = (body.features as { key: string }[]).map((feature) => feature.key);
    expect(keys).toContain(FEATURE.REPORT_REDEEMED);
    expect(keys).not.toContain(FEATURE.REPORT_PROFIT);
    // FBY-only функции на FBS-магазине не показываются.
    expect(keys).not.toContain(FEATURE.FBY);

    const raw = JSON.stringify(body);
    for (const secret of [
      'SECRET-TOKEN',
      '12345678',
      '87654321',
      'campaign_id',
      'business_id',
      '"token"',
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('админ без записи доступа — «Администратор»', async () => {
    const token = await changePassword(await boot({ admin: true }));
    const body = await (await get('profile', token)).json();
    expect(body).toMatchObject({
      isAdmin: true,
      access: { status: null, label: '👑 Администратор' },
      registeredAt: null,
    });
  });

  it('справка — та же модель, что у бота, с контактом поддержки', async () => {
    const token = await changePassword(await boot());
    const response = await get('help', token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(helpModel());
  });
});
