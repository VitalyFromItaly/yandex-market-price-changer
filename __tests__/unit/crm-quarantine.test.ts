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
import { CrmQuarantineController } from '../../src/modules/crm/quarantine/crm-quarantine.controller';
import { parseOfferIds, splitByLive } from '../../src/modules/crm/quarantine/crm-quarantine.domain';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { QuarantinePartialConfirmError } from '../../src/modules/yandex/quarantine/quarantine.domain';
import { QuarantineService } from '../../src/modules/yandex/quarantine/quarantine.service';
import { storeKeyOf } from '../../src/modules/yandex/stores/stores.domain';
import { StoresService } from '../../src/modules/yandex/stores/stores.service';
import { YandexApiError, YandexAuthError } from '../../src/modules/yandex/yandex-api.errors';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';
const TOKEN = 'ACMA:SECRET-TOKEN';

const FBS = {
  campaignId: '148655119',
  businessId: '164225008',
  businessName: 'SBrand',
  storeName: 'Время с SBrand',
  placementType: 'FBS',
};
const OTHER = {
  campaignId: '555000',
  businessId: '777000',
  businessName: 'Другой кабинет',
  storeName: 'other.ru',
  placementType: 'FBS',
};

const OFFERS = [
  {
    offerId: 'CASIO-1',
    verdicts: [{ type: 'PRICE_CHANGE', currentPrice: 1000, lastValidPrice: 5000 }],
  },
  { offerId: 'CASIO-2', verdicts: [{ type: 'LOW_PRICE', currentPrice: 100, minPrice: 900 }] },
];

/**
 * «Карантин цен» CRM на настоящем HTTP. Пинится: фича закрывает маршрут,
 * магазин — из ключа (кабинет чужого магазина не открыть), отсутствующая цена —
 * null, подтверждается только живой карантин, частичный сбой называет число.
 */
describe('CRM «Карантин цен» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  const getQuarantineOffers = vi.fn();
  const confirmQuarantinePrices = vi.fn();
  const forStore = vi.fn();

  async function boot(features: Record<string, boolean> = { [FEATURE.PRICE_QUARANTINE]: true }) {
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        campaign_id: FBS.campaignId,
        business_id: FBS.businessId,
        name: FBS.storeName,
        token: TOKEN,
        stores: [FBS, OTHER],
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

    @Module({
      imports: [CrmModule],
      controllers: [CrmQuarantineController],
      providers: [
        StoresService,
        QuarantineService,
        { provide: YandexClientFactory, useValue: { forStore } },
      ],
    })
    class QuarantineTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [QuarantineTestModule] })
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
    return fetch(`${base}/api/crm/ym/quarantine${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const key = storeKeyOf(FBS.campaignId);

  beforeEach(() => {
    getQuarantineOffers.mockReset().mockResolvedValue(OFFERS);
    confirmQuarantinePrices.mockReset().mockResolvedValue(undefined);
    forStore.mockReset().mockReturnValue({ getQuarantineOffers, confirmQuarantinePrices });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('фича закрыта → 403 FEATURE_DISABLED, Маркет не спрошен', async () => {
    await boot({});
    const response = await call('GET', `?store=${key}`);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('FEATURE_DISABLED');
    expect(forStore).not.toHaveBeenCalled();
  });

  it('без магазина → 400, чужой ключ → 404 STORE_NOT_FOUND', async () => {
    await boot();
    expect((await call('GET', '')).status).toBe(400);
    const response = await call('GET', `?store=${storeKeyOf('999999')}`);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('STORE_NOT_FOUND');
  });

  it('GET: список с подписями, отсутствующая цена — null; ни токена, ни id', async () => {
    await boot();
    const response = await call('GET', `?store=${storeKeyOf(OTHER.campaignId)}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const secret of [TOKEN, FBS.campaignId, FBS.businessId, OTHER.campaignId]) {
      expect(text).not.toContain(secret);
    }
    const view = JSON.parse(text);
    expect(view.note).toContain(`кабинета «${OTHER.businessName}»`);
    expect(view.explainer[0]).toContain('скрыты с витрины');
    expect(view).toMatchObject({
      businessName: OTHER.businessName,
      offers: [
        {
          offerId: 'CASIO-1',
          verdicts: [
            {
              type: 'PRICE_CHANGE',
              title: 'цена изменилась слишком резко',
              currentPrice: 1000,
              lastValidPrice: 5000,
              minPrice: null,
            },
          ],
        },
        {
          offerId: 'CASIO-2',
          verdicts: [
            {
              type: 'LOW_PRICE',
              title: 'цена сильно ниже рыночной',
              currentPrice: 100,
              lastValidPrice: null,
              minPrice: 900,
            },
          ],
        },
      ],
    });
    // Клиент построен по ОТКРЫТОМУ магазину, не по активному в боте.
    expect(forStore.mock.calls[0][0]).toMatchObject({
      campaign_id: OTHER.campaignId,
      business_id: OTHER.businessId,
    });
  });

  it('POST: подтверждается только то, что ещё в карантине', async () => {
    await boot();
    const response = await call('POST', '/confirm', {
      store: key,
      offerIds: ['CASIO-1', 'GONE', 'CASIO-1'],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmed: 1, stale: 1 });
    expect(confirmQuarantinePrices).toHaveBeenCalledTimes(1);
    expect(confirmQuarantinePrices.mock.calls[0][0]).toEqual(['CASIO-1']);
  });

  it('POST: всё уже вышло из карантина — записи нет', async () => {
    await boot();
    getQuarantineOffers.mockResolvedValue([]);
    const response = await call('POST', '/confirm', { store: key, offerIds: ['CASIO-1'] });
    expect(await response.json()).toEqual({ confirmed: 0, stale: 1 });
    expect(confirmQuarantinePrices).not.toHaveBeenCalled();
  });

  it('POST: пустой или битый список → 400 INVALID_OFFERS, записи нет', async () => {
    await boot();
    for (const offerIds of [[], 'CASIO-1', [''], [42]]) {
      const response = await call('POST', '/confirm', { store: key, offerIds });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('INVALID_OFFERS');
    }
    expect(confirmQuarantinePrices).not.toHaveBeenCalled();
  });

  it('POST: сбой после первого батча → 502 QUARANTINE_PARTIAL с числом подтверждённых', async () => {
    await boot();
    confirmQuarantinePrices.mockImplementation(
      async (_ids: string[], onBatch?: (n: number) => void) => {
        onBatch?.(1);
        throw new YandexApiError('boom', 500);
      },
    );
    const response = await call('POST', '/confirm', {
      store: key,
      offerIds: ['CASIO-1', 'CASIO-2'],
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'QUARANTINE_PARTIAL', confirmed: 1, requested: 2 });
    expect(body.message).toContain('Подтверждено 1 из 2');
  });

  it('ошибка Маркета → 502 MARKET_ERROR с его текстом', async () => {
    await boot();
    getQuarantineOffers.mockRejectedValue(new YandexAuthError('nope', 401));
    const response = await call('GET', `?store=${key}`);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe('MARKET_ERROR');
    expect(body.message).toBe(new YandexAuthError('nope', 401).userMessage);
  });
});

describe('QuarantineService', () => {
  const confirmQuarantinePrices = vi.fn();
  const service = new QuarantineService({
    forStore: () => ({ confirmQuarantinePrices }),
  } as unknown as YandexClientFactory);
  const store = {} as never;

  beforeEach(() => confirmQuarantinePrices.mockReset());

  it('пустой список — без запроса; повторы схлопываются', async () => {
    expect(await service.confirm(store, [])).toBe(0);
    expect(confirmQuarantinePrices).not.toHaveBeenCalled();

    expect(await service.confirm(store, ['a', 'a', 'b'])).toBe(2);
    expect(confirmQuarantinePrices.mock.calls[0][0]).toEqual(['a', 'b']);
  });

  it('сбой на первом батче — исходная ошибка, после успешного — частичная', async () => {
    const failure = new YandexApiError('boom', 500);
    confirmQuarantinePrices.mockRejectedValueOnce(failure);
    await expect(service.confirm(store, ['a'])).rejects.toBe(failure);

    confirmQuarantinePrices.mockImplementationOnce(
      async (_ids: string[], onBatch: (n: number) => void) => {
        onBatch(200);
        throw failure;
      },
    );
    const error = await service.confirm(store, ['a', 'b']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuarantinePartialConfirmError);
    expect(error).toMatchObject({ confirmed: 200, requested: 2, cause: failure });
  });
});

describe('crm-quarantine.domain', () => {
  it('parseOfferIds: обрезает, схлопывает, отвергает мусор и длинные', () => {
    expect(parseOfferIds([' a ', 'a', 'b'])).toEqual(['a', 'b']);
    expect(parseOfferIds(['x'.repeat(256)])).toBeNull();
    expect(parseOfferIds(null)).toBeNull();
  });

  it('splitByLive: пересечение с живым карантином', () => {
    expect(splitByLive(['a', 'b'], [{ offerId: 'b', verdicts: [] }])).toEqual({
      toConfirm: ['b'],
      stale: 1,
    });
  });
});
