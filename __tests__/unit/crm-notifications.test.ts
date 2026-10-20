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
import { SellerNotificationSettings } from '../../src/database/schemas/seller-notification-settings.schema';
import { SellerNotification } from '../../src/database/schemas/seller-notification.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { SellerNotificationSettingsService } from '../../src/database/services/seller-notification-settings.service';
import { SellerNotificationService } from '../../src/database/services/seller-notification.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmNotificationsController } from '../../src/modules/crm/notifications/crm-notifications.controller';
import { INVALID_SETTING } from '../../src/modules/crm/notifications/crm-notifications.domain';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { SellerNotificationsScheduler } from '../../src/modules/telegram/queue/services/seller-notifications.scheduler';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';
const OPEN = { [FEATURE.FINANCE]: true, [FEATURE.NOTIFICATIONS]: true };

/** «Уведомления» CRM на настоящем HTTP: гейт фич, лента, отметка, настройки, проверка по кнопке. */
describe('CRM «Уведомления» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  let feed: ReturnType<typeof inMemoryModel>;
  let scheduler: { refresh: ReturnType<typeof vi.fn>; checkNow: ReturnType<typeof vi.fn> };

  async function boot(features: Record<string, boolean>) {
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');
    feed = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        rule: 'low_stock',
        subjectKey: 'p1',
        fingerprint: 'low_stock',
        marketplace: null,
        title: 'Мало остатка: Casio A1',
        body: 'Доступно 3 шт.',
        active: true,
        readAt: null,
        sentAt: null,
        resolvedAt: null,
        expireAt: null,
      },
      {
        telegramUserId: '999999',
        rule: 'low_stock',
        subjectKey: 'p9',
        fingerprint: 'low_stock',
        marketplace: null,
        title: 'Чужое',
        body: 'Чужое',
        active: true,
        readAt: null,
      },
    ]);
    const settingsModel = inMemoryModel();
    settingsModel.uniqueBy('telegramUserId');
    scheduler = { refresh: vi.fn(async () => undefined), checkNow: vi.fn(async () => undefined) };

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        SellerNotificationService,
        SellerNotificationSettingsService,
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        {
          provide: getModelToken(YandexMarket.name),
          useValue: inMemoryModel([
            {
              telegramUserId: SELLER_ID,
              campaign_id: '12345678',
              business_id: '87654321',
              token: 'SECRET-TOKEN',
            },
          ]),
        },
        { provide: getModelToken(SellerNotification.name), useValue: feed },
        { provide: getModelToken(SellerNotificationSettings.name), useValue: settingsModel },
        { provide: SellerNotificationsScheduler, useValue: scheduler },
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
        SellerNotificationService,
        SellerNotificationSettingsService,
        SellerNotificationsScheduler,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({ imports: [CrmModule], controllers: [CrmNotificationsController] })
    class NotificationsTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [NotificationsTestModule] })
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
    return fetch(`${base}/api/crm/ym/notifications${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  it('фича выключена (или без finance) — 403 FEATURE_DISABLED на всех маршрутах', async () => {
    for (const features of [{}, { [FEATURE.NOTIFICATIONS]: true }]) {
      await boot(features);
      for (const [method, path, body] of [
        ['GET', ''],
        ['POST', '/read', { all: true }],
        ['GET', '/settings'],
        ['PUT', '/settings', { rules: { low_stock: { threshold: 3 } } }],
        ['POST', '/check'],
      ] as const) {
        const response = await call(method, path, body);
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
      }
      expect(scheduler.checkNow).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it('лента — только свои; «прочитать все» гасит непрочитанные', async () => {
    await boot(OPEN);
    const list = (await (await call('GET', '')).json()) as {
      items: { id: string; title: string; read: boolean; ruleLabel: string }[];
      unread: number;
    };
    expect(list.items.map((item) => item.title)).toEqual(['Мало остатка: Casio A1']);
    expect(list.items[0]).toMatchObject({ read: false, ruleLabel: 'Мало остатка' });
    expect(list.unread).toBe(1);

    expect((await call('POST', '/read', { ids: 'x' })).status).toBe(400);
    const read = await call('POST', '/read', { all: true });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ updated: 1 });
    const after = (await (await call('GET', '?unread=1')).json()) as {
      items: unknown[];
      unread: number;
    };
    expect(after).toMatchObject({ items: [], unread: 0 });
  });

  it('настройки: порог проверяется, правило сохраняется; Telegram — только с notifications_telegram', async () => {
    await boot(OPEN);
    const view = (await (await call('GET', '/settings')).json()) as {
      telegramAvailable: boolean;
      rules: { key: string; threshold: number | null }[];
    };
    expect(view.telegramAvailable).toBe(false);
    expect(view.rules.find((rule) => rule.key === 'low_stock').threshold).toBe(5);

    const bad = await call('PUT', '/settings', { rules: { low_stock: { threshold: 0 } } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: INVALID_SETTING,
      field: 'rules.low_stock.threshold',
    });
    expect((await call('PUT', '/settings', { rules: { nope: {} } })).status).toBe(400);

    const ok = (await (
      await call('PUT', '/settings', { rules: { low_stock: { threshold: 3, enabled: false } } })
    ).json()) as { rules: { key: string; threshold: number; enabled: boolean }[] };
    expect(ok.rules.find((rule) => rule.key === 'low_stock')).toMatchObject({
      threshold: 3,
      enabled: false,
    });

    const telegram = await call('PUT', '/settings', { time: '10:00' });
    expect(telegram.status).toBe(403);
    expect(((await telegram.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
  });

  it('время меняется с notifications_telegram — тем же разбором, с пересверкой расписания', async () => {
    await boot({ ...OPEN, [FEATURE.NOTIFICATIONS_TELEGRAM]: true });
    const bad = await call('PUT', '/settings', { time: '25:00' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: INVALID_SETTING, field: 'time' });

    const ok = (await (
      await call('PUT', '/settings', { time: '7.30', telegram: false })
    ).json()) as {
      telegramAvailable: boolean;
      time: string;
      telegram: boolean;
    };
    expect(ok).toMatchObject({ telegramAvailable: true, time: '07:30', telegram: false });
    expect(scheduler.refresh).toHaveBeenCalledTimes(1);
  });

  it('«Проверить сейчас» ставит задачу, а не считает в запросе', async () => {
    await boot(OPEN);
    const response = await call('POST', '/check');
    expect(response.status).toBe(202);
    expect(scheduler.checkNow).toHaveBeenCalledWith(SELLER_ID);
  });
});
