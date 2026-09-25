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
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AccessNotifierService } from '../../src/modules/access/access-notifier.service';
import {
  AccessController,
  CRM_PASSWORD_RESET_KIND,
} from '../../src/modules/access/access.controller';
import { AdminAuthModule } from '../../src/modules/admin/admin-auth.module';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const ADMIN_ID = '309809755';
const SELLER_ID = '222';

/**
 * Сброс пароля CRM из админ-панели — на настоящем HTTP, обе панели в одном
 * приложении: админ входит, сбрасывает, старая сессия продавца гаснет, вход
 * стартовым паролем снова ведёт на обязательную смену.
 */
describe('Сброс пароля CRM из панели по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let journal: ReturnType<typeof inMemoryModel>;

  afterEach(async () => {
    await app?.close();
  });

  async function boot(): Promise<string> {
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya' },
    ]);
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        name: 'Время с SBrand',
        campaign_id: '12345678',
        business_id: '87654321',
        token: 'SECRET-TOKEN',
      },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');
    journal = inMemoryModel();

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        { provide: getModelToken(ActionLog.name), useValue: journal },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        { provide: PurchasePriceService, useValue: {} },
        { provide: ReportScheduleService, useValue: {} },
        {
          provide: AppConfigService,
          useValue: {
            isAdmin: (id: unknown) => String(id) === ADMIN_ID,
            crmInitialPassword: INITIAL,
            adminPassword: undefined,
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
        ReportScheduleService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    // AccessModule целиком тянет TelegramModule (уведомления продавцу) — здесь
    // тот же контроллер с теми же модулями входа, но без графа бота.
    @Module({
      imports: [CrmModule, AdminAuthModule],
      controllers: [AccessController],
      providers: [{ provide: AccessNotifierService, useValue: { notify: vi.fn() } }],
    })
    class ResetTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ResetTestModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    const adminPassword = (await moduleRef.get(AdminCredentialService).ensure())!;

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    const adminLogin = await post('/api/auth/login', { login: ADMIN_ID, password: adminPassword });
    return ((await adminLogin.json()) as { token: string }).token;
  }

  function post(path: string, body?: unknown, token?: string) {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function crmLogin(password: string) {
    const response = await post('/api/crm/auth/login', { login: 'vasya', password });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  const me = (token: string) =>
    fetch(`${base}/api/crm/auth/me`, { headers: { authorization: `Bearer ${token}` } });

  const card = async (adminToken: string) =>
    (await (
      await fetch(`${base}/api/access/users/${SELLER_ID}?botId=999`, {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json()) as Record<string, any>;

  it('сброс гасит сессию, стартовый пароль снова требует смены', async () => {
    const adminToken = await boot();

    // В CRM не входил — в карточке пусто, сбрасывать нечего.
    expect((await card(adminToken)).crm).toBeNull();
    expect(
      (await post(`/api/access/users/${SELLER_ID}/crm-password-reset`, undefined, adminToken))
        .status,
    ).toBe(404);

    // Продавец вошёл и сменил пароль — карточка это видит.
    const first = await crmLogin(INITIAL);
    const changed = await post(
      '/api/crm/auth/password',
      { current: INITIAL, next: 'my-own-password' },
      first.body.token,
    );
    const own = ((await changed.json()) as { token: string }).token;
    expect((await me(own)).status).toBe(200);

    const before = await card(adminToken);
    expect(before.crm.lastLoginAt).toBeTruthy();
    expect(before.crm.mustChangePassword).toBe(false);
    expect(JSON.stringify(before)).not.toContain('passwordHash');

    // Без токена панели — 401, сброса не было.
    expect((await post(`/api/access/users/${SELLER_ID}/crm-password-reset`)).status).toBe(401);
    expect((await me(own)).status).toBe(200);

    const reset = await post(
      `/api/access/users/${SELLER_ID}/crm-password-reset`,
      undefined,
      adminToken,
    );
    expect(reset.status).toBe(200);
    const text = await reset.text();
    expect(text).not.toContain(INITIAL);
    expect(JSON.parse(text).crm.mustChangePassword).toBe(true);

    // Старая сессия вылетает; свой пароль больше не подходит; стартовый — на смену.
    expect((await me(own)).status).toBe(401);
    expect((await crmLogin('my-own-password')).status).toBe(401);
    const again = await crmLogin(INITIAL);
    expect(again.status).toBe(200);
    expect(again.body.mustChangePassword).toBe(true);

    // Кто сбросил — в журнале, автор из токена панели.
    const row = journal.documents.find((d) => d.kind === CRM_PASSWORD_RESET_KIND);
    expect(row).toMatchObject({ telegramUserId: SELLER_ID, context: `admin:${ADMIN_ID}` });
  });
});
