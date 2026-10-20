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
import { CostHistoryService } from '../../src/database/services/cost-history.service';
import { ProductService } from '../../src/database/services/product.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { FinanceImportScheduler } from '../../src/modules/telegram/queue/services/finance-import.scheduler';
import { SellerNotificationsScheduler } from '../../src/modules/telegram/queue/services/seller-notifications.scheduler';
import { StockPushScheduler } from '../../src/modules/telegram/queue/services/stock-push.scheduler';
import { WeeklyDigestScheduler } from '../../src/modules/telegram/queue/services/weekly-digest.scheduler';
import { AccessNotifierService } from '../../src/modules/access/access-notifier.service';
import { AccessController, CRM_IMPERSONATE_KIND } from '../../src/modules/access/access.controller';
import { ProductMatchService } from '../../src/modules/products/product-match.service';
import { AdminAuthModule } from '../../src/modules/admin/admin-auth.module';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const ADMIN_ID = '100000001';
const SELLER_ID = '222';
const PENDING_ID = '333';

/**
 * Вход админа в CRM «за продавца» (TASK-172) — на настоящем HTTP: токен из
 * панели открывает CRM с фичами продавца, журнал помечает руку админа, а снятие
 * админа или отзыв доступа продавца гасят режим на следующем запросе.
 */
describe('Вход в CRM за продавца по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let journal: ReturnType<typeof inMemoryModel>;
  let accessModel: ReturnType<typeof inMemoryModel>;
  let crm: ReturnType<typeof inMemoryModel>;
  let admins: Set<string>;

  afterEach(async () => {
    await app?.close();
  });

  async function boot(): Promise<string> {
    admins = new Set([ADMIN_ID]);
    const access = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        botId: '999',
        status: 'approved',
        username: 'Vasya',
        features: { overview: false, finance: true },
      },
      { telegramUserId: PENDING_ID, botId: '999', status: 'pending', username: 'Petya' },
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
    accessModel = access;
    crm = inMemoryModel();
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
        { provide: ProductService, useValue: {} },
        { provide: CostHistoryService, useValue: {} },
        { provide: ReportScheduleService, useValue: {} },
        {
          provide: AppConfigService,
          useValue: {
            isAdmin: (id: unknown) => admins.has(String(id)),
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
        ProductService,
        CostHistoryService,
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
      providers: [
        { provide: AccessNotifierService, useValue: { notify: vi.fn() } },
        { provide: FinanceImportScheduler, useValue: { refresh: vi.fn() } },
        { provide: SellerNotificationsScheduler, useValue: { refresh: vi.fn() } },
        { provide: WeeklyDigestScheduler, useValue: { refresh: vi.fn() } },
        { provide: StockPushScheduler, useValue: { refresh: vi.fn() } },
        { provide: ProductMatchService, useValue: {} },
      ],
    })
    class ImpersonateTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ImpersonateTestModule] })
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

  const me = (token: string) =>
    fetch(`${base}/api/crm/auth/me`, { headers: { authorization: `Bearer ${token}` } });

  async function impersonate(adminToken: string | undefined, id = SELLER_ID) {
    const response = await post(`/api/access/users/${id}/crm-impersonate`, undefined, adminToken);
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  /** Журнал пишется по `finish` без ожидания — даём ему тик. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('токен панели открывает CRM с фичами продавца и пометкой режима', async () => {
    const adminToken = await boot();

    expect((await impersonate(undefined)).status).toBe(401);

    const { status, body } = await impersonate(adminToken);
    expect(status).toBe(200);
    const response = await me(body.token);
    expect(response.status).toBe(200);
    const profile = (await response.json()) as Record<string, any>;
    expect(profile).toMatchObject({
      telegramUserId: SELLER_ID,
      isAdmin: false,
      mustChangePassword: false,
      impersonation: { adminId: ADMIN_ID },
    });
    // Фичи продавца, а не «всё открыто» админа.
    expect(profile.features.overview).toBe(false);
    expect(profile.features.finance).toBe(true);

    // Учётка CRM продавцу не заводится, его «последний вход» не трогается.
    expect(crm.documents).toHaveLength(0);

    // Пароль продавца в режиме не меняется.
    const password = await post(
      '/api/crm/auth/password',
      { current: INITIAL, next: 'admin-chosen-password' },
      body.token,
    );
    expect(password.status).toBe(403);
    expect(((await password.json()) as { code: string }).code).toBe('IMPERSONATION_FORBIDDEN');

    await settle();
    const start = journal.documents.find((d) => d.kind === CRM_IMPERSONATE_KIND);
    expect(start).toMatchObject({ telegramUserId: SELLER_ID, context: `admin:${ADMIN_ID}` });
    const request = journal.documents.find(
      (d) => d.kind === 'request' && String(d.action).includes('/api/crm/auth/me'),
    );
    expect(request).toMatchObject({
      telegramUserId: SELLER_ID,
      context: `impersonated-by:${ADMIN_ID}`,
    });
    expect(JSON.stringify(journal.documents)).not.toContain(body.token);
  });

  it('снятие админа и отзыв доступа продавца гасят режим; неодобренного не открыть', async () => {
    const adminToken = await boot();

    expect((await impersonate(adminToken, PENDING_ID)).status).toBe(409);

    const { body } = await impersonate(adminToken);
    expect((await me(body.token)).status).toBe(200);

    admins.delete(ADMIN_ID);
    expect((await me(body.token)).status).toBe(401);
    admins.add(ADMIN_ID);
    expect((await me(body.token)).status).toBe(200);

    accessModel.documents.find((d) => d.telegramUserId === SELLER_ID).status = 'rejected';
    expect((await me(body.token)).status).toBe(401);
  });
});
