import type { INestApplication } from '@nestjs/common';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Controller, Get, Global, Module, UseGuards } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import { crmLogEntry } from '../../src/modules/crm/crm-action-log.domain';
import { RequireFeature } from '../../src/modules/crm/crm-auth.decorators';
import {
  CRM_SECTIONS,
  CRM_STORE_SECTIONS,
  FBY_ONLY,
  FEATURE_DISABLED,
  featureBlock,
  visibleSections,
} from '../../src/modules/crm/crm-features.domain';
import { CrmJwtGuard } from '../../src/modules/crm/crm-jwt.guard';
import { CrmModule } from '../../src/modules/crm/crm.module';
import {
  FEATURE,
  allFeaturesEnabled,
  isFeatureOpen,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

describe('isFeatureOpen — одно правило на бот и CRM', () => {
  it('FBY-only закрыта у не-FBY и неизвестной модели даже при включённом флаге', () => {
    const all = allFeaturesEnabled();
    expect(isFeatureOpen(all, FEATURE.FBY, 'FBS')).toBe(false);
    expect(isFeatureOpen(all, FEATURE.WAREHOUSES, undefined)).toBe(false);
    expect(isFeatureOpen(all, FEATURE.FBY, 'fby')).toBe(true);
  });

  it('обычная фича от модели не зависит, умолчания применяются', () => {
    expect(isFeatureOpen({}, FEATURE.REPORT_PROFIT, undefined)).toBe(true);
    expect(isFeatureOpen({ [FEATURE.REPORT_PROFIT]: false }, FEATURE.REPORT_PROFIT)).toBe(false);
    expect(isFeatureOpen({}, FEATURE.TARIFF_CALC)).toBe(false);
  });
});

describe('crm-features.domain', () => {
  it('разделы CRM ровно те же, что в crm/src/navigation.ts', () => {
    // Белый список живёт на бэкенде, пункты — на фронте. Раздел, забытый здесь,
    // пропадёт из сайдбара у всех, — тест называет его раньше продавца.
    const source = readFileSync(join(__dirname, '../../crm/src/navigation.ts'), 'utf8');
    const names = [...source.matchAll(/\bname: '([^']+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(Object.keys(CRM_SECTIONS).sort());
  });

  it('разделы внутри магазина — ровно STORE_NAV фронта', () => {
    // Раздел, попавший не в тот список, либо потеряет магазин из адреса (отчёт
    // без магазина сервер не ставит), либо будет решаться по активному в боте.
    const source = readFileSync(join(__dirname, '../../crm/src/navigation.ts'), 'utf8');
    const block = source.slice(source.indexOf('export const STORE_NAV'));
    const storeNav = block.slice(0, block.indexOf('];'));
    const names = [...storeNav.matchAll(/\bname: '([^']+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...CRM_STORE_SECTIONS].sort());
  });

  it('scope делит разделы: аккаунт без отчётов, магазин без настроек', () => {
    const account = visibleSections({}, 'FBS', 'account');
    const store = visibleSections({}, 'FBS', 'store');
    expect(account).toEqual(expect.arrayContaining(['ym-stores', 'ym-settings', 'profile']));
    expect(account).not.toContain('ym-orders');
    expect(store).toEqual(expect.arrayContaining(['ym-dashboard', 'ym-orders', 'ym-price-list']));
    expect(store).not.toContain('ym-settings');
  });

  it('«FBY» и «Склады» — только у FBY-магазина и только при открытой фиче', () => {
    const open = { [FEATURE.FBY]: true, [FEATURE.WAREHOUSES]: true };
    expect(visibleSections(open, 'FBY', 'store')).toEqual(
      expect.arrayContaining(['ym-fby', 'ym-warehouses']),
    );
    expect(visibleSections(open, 'FBS', 'store')).not.toContain('ym-fby');
    expect(visibleSections(open, 'FBS', 'store')).not.toContain('ym-warehouses');
    // Обе фичи по умолчанию выключены — открываются по продавцу из панели.
    expect(visibleSections({}, 'FBY', 'store')).not.toContain('ym-fby');
  });

  it('закрытая «Прибыль» прячет только свой раздел', () => {
    const sections = visibleSections({ [FEATURE.REPORT_PROFIT]: false }, 'FBS');
    expect(sections).not.toContain('ym-profit');
    expect(sections).toContain('ym-orders');
    expect(sections).toContain('ym-settings');
  });

  it('«Отчёты» и «Прайс» видны, пока открыта хоть одна их фича', () => {
    const closed = {
      [FEATURE.REPORT_SHIPPED_TODAY]: false,
      [FEATURE.REPORT_REDEEMED]: false,
      [FEATURE.REPORT_RETURNING]: false,
      [FEATURE.PURCHASE_PRICES]: false,
    };
    expect(visibleSections(closed)).toContain('ym-orders');
    expect(visibleSections(closed)).toContain('ym-price-list');
    expect(
      visibleSections({
        ...closed,
        [FEATURE.REPORT_IN_TRANSIT]: false,
        [FEATURE.STOCK_UPDATE]: false,
      }),
    ).not.toEqual(expect.arrayContaining(['ym-orders', 'ym-price-list']));
  });

  it('нужны все ключи; FBY-отказ объясняется моделью, а не администратором', () => {
    expect(featureBlock({}, [FEATURE.SCHEDULE, FEATURE.REPORT_PROFIT])).toBeNull();
    expect(
      featureBlock({ [FEATURE.REPORT_PROFIT]: false }, [FEATURE.SCHEDULE, FEATURE.REPORT_PROFIT])
        ?.code,
    ).toBe(FEATURE_DISABLED);
    const fby = featureBlock(allFeaturesEnabled(), [FEATURE.FBY], 'FBS');
    expect(fby?.code).toBe(FBY_ONLY);
    expect(fby?.message).toContain('модель FBS');
    expect(fby?.message).not.toContain('<b>');
  });
});

describe('crmLogEntry', () => {
  it('строка CRM: source/botId crm, секреты в адресе замаскированы, тела нет', () => {
    const entry = crmLogEntry(
      {
        method: 'GET',
        url: '/api/crm/ym/profit?campaign=12345678',
        statusCode: 403,
        durationMs: 7,
        telegramUserId: SELLER_ID,
        error: 'закрыто',
      },
      'system',
    );
    expect(entry).toMatchObject({
      telegramUserId: SELLER_ID,
      botId: 'crm',
      source: 'crm',
      kind: 'request',
      status: 'error',
      httpStatus: 403,
      error: 'закрыто',
    });
    expect(entry.action).not.toContain('12345678');
  });

  it('без продавца — system, успешный запрос без error', () => {
    const entry = crmLogEntry(
      { method: 'GET', url: '/api/crm/auth/me', statusCode: 200, durationMs: 1, error: 'x' },
      'system',
    );
    expect(entry.telegramUserId).toBe('system');
    expect(entry.status).toBe('ok');
    expect(entry.error).toBeUndefined();
  });
});

/**
 * Журнал на настоящем HTTP: middleware вешается по пути, и то, что Nest
 * добавляет к нему глобальный `/api`, — поведение фреймворка, а не наше.
 * Проверяется запросом, а не чтением кода.
 */
describe('CrmModule по HTTP: гейт и журнал', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let logs: ReturnType<typeof inMemoryModel>;
  let base: string;

  beforeEach(async () => {
    logs = inMemoryModel();
    const access = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        botId: '999',
        status: 'approved',
        username: 'Vasya',
        features: { [FEATURE.REPORT_PROFIT]: false },
      },
    ]);
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        campaign_id: '12345678',
        business_id: '1',
        token: 't',
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
        { provide: getModelToken(ActionLog.name), useValue: logs },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
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
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    // Пробный маршрут под гейтом: тест проверяет гвард и журнал, а не
    // продуктовый адрес — отчёты CRM идут фоновыми задачами (CrmJobsModule).
    @Controller('crm/ym/probe')
    @UseGuards(CrmJwtGuard)
    @RequireFeature(FEATURE.REPORT_PROFIT)
    class ProbeController {
      @Get()
      probe(): { ok: boolean } {
        return { ok: true };
      }
    }

    @Module({ imports: [CrmModule], controllers: [ProbeController] })
    class ProbeModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterEach(async () => {
    await app.close();
  });

  async function waitForLogs(count: number) {
    for (let i = 0; i < 50 && logs.documents.length < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('закрытая «Прибыль» → 403; вход и отказ — в журнале у продавца, пароля там нет', async () => {
    const login = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'vasya', password: INITIAL }),
    });
    const { token } = (await login.json()) as { token: string };
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    const fresh = ((await change.json()) as { token: string }).token;

    const profit = await fetch(`${base}/api/crm/ym/probe`, {
      headers: { authorization: `Bearer ${fresh}` },
    });
    expect(profit.status).toBe(403);
    expect(((await profit.json()) as { code: string }).code).toBe(FEATURE_DISABLED);

    await waitForLogs(3);
    const rows = logs.documents.filter((row) => row.source === 'crm');
    expect(rows.map((row) => row.action)).toEqual([
      'POST /api/crm/auth/login',
      'POST /api/crm/auth/password',
      'GET /api/crm/ym/probe',
    ]);
    expect(rows.every((row) => row.telegramUserId === SELLER_ID)).toBe(true);
    expect(rows[2]).toMatchObject({ status: 'error', httpStatus: 403, username: 'Vasya' });
    expect(JSON.stringify(logs.documents)).not.toContain(INITIAL);
  });

  it('без токена — строка от system', async () => {
    const response = await fetch(`${base}/api/crm/ym/probe`);
    expect(response.status).toBe(401);
    await waitForLogs(1);
    expect(logs.documents[0]).toMatchObject({ telegramUserId: 'system', source: 'crm' });
  });
});
