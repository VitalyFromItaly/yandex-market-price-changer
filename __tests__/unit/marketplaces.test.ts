import type { INestApplication } from '@nestjs/common';

import { readFileSync } from 'fs';
import { join } from 'path';

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
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import {
  MARKETPLACE_CAPABILITIES,
  MarketplaceNotConnectedError,
} from '../../src/modules/marketplaces/marketplace-adapter';
import {
  availableMarketplaces,
  connectionsView,
} from '../../src/modules/marketplaces/marketplace-connections.domain';
import { MarketplaceConnectionsService } from '../../src/modules/marketplaces/marketplace-connections.service';
import { availableBySku, ymStockLevels } from '../../src/modules/marketplaces/marketplace-stocks';
import { ymMarketplaceOrder } from '../../src/modules/marketplaces/ym-orders';
import { productRowsFromCatalog } from '../../src/modules/products/product.domain';
import {
  capabilityTable,
  MarketplaceRegistry,
} from '../../src/modules/marketplaces/marketplace-registry.service';
import { YmMarketplaceAdapter } from '../../src/modules/marketplaces/ym-marketplace.adapter';
import { MARKETPLACES as PRODUCT_MARKETPLACES } from '../../src/modules/products/product.domain';
import { isMarketplace, MARKETPLACE_LABEL, MARKETPLACES } from '../../src/shared/marketplace';
import { inMemoryModel } from '../helpers/in-memory-model';

const SELLER = '222';
const YM_TOKEN = 'ACMA:YM-SECRET-TOKEN';
const CAMPAIGN = '148655119';
const BUSINESS = '164225008';
const OZON_KEY = 'ozon-api-key-SECRET';
const OZON_CLIENT = '9988776655';

const YM_DOC = {
  telegramUserId: SELLER,
  token: YM_TOKEN,
  campaign_id: CAMPAIGN,
  business_id: BUSINESS,
  stores: [
    { campaignId: CAMPAIGN, businessId: BUSINESS, businessName: 'SBrand', storeName: 'FBS' },
    { campaignId: '148704883', businessId: BUSINESS, businessName: 'SBrand', storeName: 'FBY' },
  ],
};

describe('площадки: общий список', () => {
  it('один список на весь код — товары берут его же', () => {
    expect(MARKETPLACES).toEqual(['ym', 'ozon', 'wb']);
    expect(PRODUCT_MARKETPLACES).toBe(MARKETPLACES);
    expect(Object.keys(MARKETPLACE_LABEL).sort()).toEqual([...MARKETPLACES].sort());
  });

  it('CRM знает те же площадки с теми же подписями (navigation.ts читается как текст)', () => {
    const source = readFileSync(join(__dirname, '../../web/crm/src/navigation.ts'), 'utf8');
    const block = source.slice(source.indexOf('export const ALL_MARKETPLACES'));
    const pairs = [...block.matchAll(/\{ key: '([a-z]+)', label: '([^']+)'/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(pairs).toEqual(MARKETPLACES.map((key) => [key, MARKETPLACE_LABEL[key]]));
  });

  it('ключ из HTTP — только из белого списка', () => {
    expect(isMarketplace('ozon')).toBe(true);
    expect(isMarketplace('amazon')).toBe(false);
    expect(isMarketplace('toString')).toBe(false);
    expect(isMarketplace(undefined)).toBe(false);
  });
});

/**
 * Адаптер ЯМ — чистая делегация: каждая возможность отдаёт РОВНО то, что вернул
 * обёрнутый сервис, с тем же магазином. Это и есть «числа не изменились».
 */
describe('YmMarketplaceAdapter', () => {
  const REF = { telegramUserId: SELLER, marketplace: 'ym' as const };

  function setup(doc: unknown = YM_DOC) {
    const placed = {
      orders: [{ id: 1, status: 'DELIVERED', itemsTotal: 100, creationDate: '17-10-2026 10:00:00' }],
      cancelled: [{ id: 2, status: 'CANCELLED' }],
    };
    const levels = { placement: 'FBS', takenAt: new Date(), stocks: { A: 3 } };
    const catalog = [{ offerId: 'A', name: 'Часы', barcodes: ['46'], basicPrice: 100, currencyId: 'RUR' }];
    const imported = { status: 'imported' };
    const deps = {
      stores: { findByTelegramUser: vi.fn(async () => doc) },
      orders: { collectPlacedOrders: vi.fn(async () => placed) },
      finance: { importAndRecord: vi.fn(async () => imported) },
      stocks: { levels: vi.fn(async () => levels) },
      clients: { forStore: vi.fn(() => ({ loadCatalogProducts: vi.fn(async () => catalog) })) },
    };
    const adapter = new YmMarketplaceAdapter(
      deps.stores as never,
      deps.orders as never,
      deps.finance as never,
      deps.stocks as never,
      deps.clients as never,
    );
    return { adapter, deps, placed, levels, catalog, imported };
  }

  it('заказы — как есть; остатки и каталог — те же числа нашей сущностью (TASK-163)', async () => {
    const { adapter, deps, placed, levels, catalog } = setup();
    const now = new Date('2026-10-15T07:00:00Z');
    const period = { key: 'month' } as never;

    // Заказы — наша сущность (TASK-130), каждый через тот же ymMarketplaceOrder.
    expect(await adapter.orders.listOrders(REF, period, now)).toEqual({
      orders: placed.orders.map((order) => ymMarketplaceOrder(order, null)),
      cancelled: placed.cancelled.map((order) => ymMarketplaceOrder(order, null)),
    });
    expect(deps.orders.collectPlacedOrders).toHaveBeenCalledWith(YM_DOC, period, now);
    const stocks = await adapter.stocks.listStocks(REF, now);
    expect(stocks).toEqual(ymStockLevels(levels as never));
    expect(availableBySku(stocks)).toEqual(levels.stocks);
    expect(deps.stocks.levels).toHaveBeenCalledWith(YM_DOC, now);
    expect(await adapter.catalog.listProducts(REF)).toEqual(productRowsFromCatalog(catalog as never));
    expect(deps.clients.forStore).toHaveBeenCalledWith(YM_DOC);
  });

  it('импорт финансов — продавец и период, без чтения магазина', async () => {
    const { adapter, deps, imported } = setup();
    const period = { from: '2026-09-01', to: '2026-09-30' };

    expect(await adapter.finance.importFinance(REF, period)).toBe(imported);
    expect(deps.finance.importAndRecord).toHaveBeenCalledWith({ telegramUserId: SELLER, period });
    expect(deps.stores.findByTelegramUser).not.toHaveBeenCalled();
  });

  it('campaignId сужает до магазина из кэша, чужой — отказ', async () => {
    const { adapter, deps } = setup();
    await adapter.stocks.listStocks({ ...REF, campaignId: '148704883' });
    expect(deps.stocks.levels).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: '148704883', name: 'FBY' }),
      expect.any(Date),
    );

    await expect(adapter.stocks.listStocks({ ...REF, campaignId: '1' })).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
  });

  it('активный магазин открыт и у документа без кэша магазинов', async () => {
    const bare = { ...YM_DOC, stores: [] };
    const { adapter, deps } = setup(bare);
    await adapter.stocks.listStocks({ ...REF, campaignId: CAMPAIGN });
    expect(deps.stocks.levels).toHaveBeenCalledWith(bare, expect.any(Date));
  });

  it('без магазина — внятный отказ, а не запрос с пустым токеном', async () => {
    const { adapter, deps } = setup(null);
    await expect(adapter.orders.listOrders(REF, {} as never)).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
    expect(deps.orders.collectPlacedOrders).not.toHaveBeenCalled();
  });
});

/**
 * Реестр по возможностям (TASK-162): у площадки зарегистрировано ровно то, что
 * она умеет. Ozon и WB пока умеют только подключение — спросить у них финансы
 * значит получить отказ, а не заглушку (решение `ozon_adapter_after_finance`).
 */
describe('MarketplaceRegistry', () => {
  const connector = (secretField: string) => ({ secretField, check: vi.fn() });
  const data = {
    finance: { importFinance: vi.fn() },
    orders: { listOrders: vi.fn() },
    catalog: { listProducts: vi.fn() },
    stocks: { listStocks: vi.fn() },
  };

  function registry() {
    return new MarketplaceRegistry(
      { marketplace: 'ym', ...data } as never,
      { marketplace: 'ym', connection: connector('token') } as never,
      {
        marketplace: 'ozon',
        connection: connector('apiKey'),
        catalog: data.catalog,
        stocks: data.stocks,
      } as never,
      { marketplace: 'wb', connection: connector('token') } as never,
    );
  }

  it('части одной площадки складываются; Ozon — каталог и остатки, финансы только у ЯМ', () => {
    const r = registry();
    expect(r.supported()).toEqual(['ym', 'ozon']);
    expect(r.connectable()).toEqual(['ym', 'ozon', 'wb']);
    expect(r.withCapability('finance')).toEqual(['ym']);
    expect(r.withCapability('stocks')).toEqual(['ym', 'ozon']);
    expect(r.withCapability('catalog')).toEqual(['ym', 'ozon']);
    expect(r.capability('ozon', 'orders')).toBeNull();
    expect(r.require('ym', 'finance')).toBe(data.finance);
    expect(r.capability('ozon', 'connection')?.secretField).toBe('apiKey');
  });

  it('возможности, которой у площадки нет, нет и в реестре — отказ, а не заглушка', () => {
    const r = registry();
    expect(r.capability('ozon', 'finance')).toBeNull();
    expect(() => r.require('ozon', 'finance', SELLER)).toThrow(MarketplaceNotConnectedError);
    expect(() => r.require('wb', 'stocks')).toThrow(/возможности stocks ещё нет/);
  });

  it('одна возможность, заявленная дважды, — ошибка сборки', () => {
    expect(() =>
      capabilityTable([
        { marketplace: 'ozon', connection: connector('a') },
        { marketplace: 'ozon', connection: connector('b') },
      ] as never),
    ).toThrow(/заявлена дважды/);
  });

  it('все возможности перечислены', () => {
    expect(MARKETPLACE_CAPABILITIES).toEqual([
      'connection',
      'finance',
      'orders',
      'catalog',
      'stocks',
      'stockWrite',
    ]);
  });
});

/** Остатки — наша сущность (TASK-163): места хранения раздельно, без суммы. */
describe('ymStockLevels / availableBySku', () => {
  const takenAt = new Date('2026-10-18T07:00:00Z');

  it('FBY — склад Маркета, FBS — склад продавца; доступное то же число', () => {
    const fby = ymStockLevels({ placement: 'FBY', takenAt, stocks: { A: 4 } });
    expect(fby).toEqual({
      takenAt,
      placement: 'FBY',
      byLocation: { marketplace: { A: { available: 4, reserved: null } } },
    });
    const fbs = ymStockLevels({ placement: 'FBS', takenAt, stocks: { A: 2 } });
    expect(Object.keys(fbs.byLocation)).toEqual(['seller']);
    expect(availableBySku(fbs)).toEqual({ A: 2 });
    expect(availableBySku(ymStockLevels({ placement: null, takenAt, stocks: {} }))).toEqual({});
  });

  it('нет остатков — причина и null, а не пустая карта', () => {
    const none = ymStockLevels({
      placement: 'FBY',
      takenAt: null,
      stocks: null,
      error: 'rate_limit',
    });
    expect(none).toEqual({ takenAt: null, placement: 'FBY', byLocation: {}, error: 'rate_limit' });
    expect(availableBySku(none)).toBeNull();
    expect(ymStockLevels({ placement: 'FBS', takenAt: null, stocks: null }).error).toBe('generic');
  });

  it('два места без указания — отказ: смешанного склада не бывает', () => {
    const both = {
      takenAt,
      placement: null,
      byLocation: {
        marketplace: { A: { available: 1, reserved: 0 } },
        seller: { A: { available: 2, reserved: 1 } },
      },
    };
    expect(() => availableBySku(both)).toThrow(/суммы между ними нет/);
    expect(availableBySku(both, 'seller')).toEqual({ A: 2 });
    expect(availableBySku({ ...both, byLocation: { seller: {} } }, 'marketplace')).toEqual({});
  });
});

describe('availableMarketplaces', () => {
  it('Ozon «доступен» только при открытой фиче ozon, ЯМ — всегда, WB — пока нет', () => {
    expect(availableMarketplaces(['ym'], ['ozon'], {})).toEqual(['ym']);
    expect(availableMarketplaces(['ym'], ['ozon'], { ozon: true })).toEqual(['ym', 'ozon']);
    expect(availableMarketplaces(['ym'], ['ozon'], { ozon: false })).toEqual(['ym']);
    expect(availableMarketplaces(['ym'], ['ozon'], { ozon: true, wb: true })).toEqual([
      'ym',
      'ozon',
    ]);
  });
});

describe('connectionsView', () => {
  const ozonRow = {
    telegramUserId: SELLER,
    marketplace: 'ozon' as const,
    status: 'ok' as const,
    accounts: [{ id: OZON_CLIENT, name: 'Кабинет' }],
  };

  it('ЯМ — из YandexMarket, Ozon/WB — из коллекции, порядок общего списка', () => {
    expect(connectionsView(YM_DOC, [ozonRow], ['ym'])).toEqual([
      {
        key: 'ym',
        label: 'Яндекс Маркет',
        connected: true,
        status: 'ok',
        accountCount: 2,
        available: true,
      },
      {
        key: 'ozon',
        label: 'Ozon',
        connected: true,
        status: 'ok',
        accountCount: 1,
        available: false,
      },
      {
        key: 'wb',
        label: 'Wildberries',
        connected: false,
        status: 'none',
        accountCount: 0,
        available: false,
      },
    ]);
  });

  it('неполные креды ЯМ — не подключён; отвергнутый ключ Ozon — подключение есть, но не работает', () => {
    const view = connectionsView(
      { token: YM_TOKEN, campaign_id: CAMPAIGN },
      [{ ...ozonRow, status: 'rejected', accounts: [] }],
      ['ym'],
    );
    expect(view[0]).toMatchObject({ key: 'ym', connected: false, status: 'none', accountCount: 0 });
    expect(view[1]).toMatchObject({ key: 'ozon', connected: false, status: 'rejected' });
  });
});

/**
 * GET /api/crm/marketplaces на настоящем HTTP: креды обеих площадок лежат в
 * базе, и ни один ключ, id кабинета или имя поля с кредами в ответ не попадает
 * (образец — `/auth/me` в crm-auth.test и `expectNoSecrets` в crm-stores.test).
 */
describe('CRM GET /api/crm/marketplaces', { timeout: 60_000 }, () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  async function boot(features: Record<string, boolean> = {}) {
    const access = inMemoryModel([
      { telegramUserId: SELLER, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');
    // Модель в памяти `select: false` не соблюдает — тем лучше: креды
    // возвращаются из «базы», и вырезать их обязан сам сервис.
    const connections = inMemoryModel([
      {
        telegramUserId: SELLER,
        marketplace: 'ozon',
        credentials: { clientId: OZON_CLIENT, apiKey: OZON_KEY },
        status: 'ok',
        accounts: [{ id: OZON_CLIENT, name: 'Кабинет Ozon' }],
      },
    ]);

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
        { provide: getModelToken(YandexMarket.name), useValue: inMemoryModel([YM_DOC]) },
        { provide: getModelToken(MarketplaceConnection.name), useValue: connections },
        { provide: ErrorReporter, useValue: { report: async () => undefined } },
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

    // Без MarketplacesModule: он тянет Yandex и Finance, а сводке нужен
    // только реестр — с адаптером ЯМ, который здесь ни о чём не спрашивают.
    @Module({
      imports: [CrmModule],
      controllers: [CrmMarketplacesController],
      providers: [
        MarketplaceConnectionsService,
        {
          provide: MarketplaceRegistry,
          useValue: { supported: () => ['ym'], connectable: () => ['ozon'] },
        },
      ],
    })
    class MarketplacesTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [MarketplacesTestModule] })
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
    return { base, token };
  }

  it('три площадки со статусом подключения и без единого секрета', async () => {
    const { base, token } = await boot();
    const response = await fetch(`${base}/api/crm/marketplaces`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);

    const text = await response.text();
    for (const secret of [
      YM_TOKEN,
      CAMPAIGN,
      BUSINESS,
      OZON_KEY,
      OZON_CLIENT,
      'campaign_id',
      'business_id',
      '"token"',
      'credentials',
      'apiKey',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(
      JSON.parse(text).marketplaces.map((m: { key: string; connected: boolean }) => [
        m.key,
        m.connected,
      ]),
    ).toEqual([
      ['ym', true],
      ['ozon', true],
      ['wb', false],
    ]);
  });

  it('Ozon «подключить» — только при открытой фиче ozon', async () => {
    const availability = async (features: Record<string, boolean>) => {
      const { base, token } = await boot(features);
      const response = await fetch(`${base}/api/crm/marketplaces`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as {
        marketplaces: Array<{ key: string; available: boolean }>;
      };
      await app.close();
      return body.marketplaces.map((m) => [m.key, m.available]);
    };
    expect(await availability({})).toEqual([
      ['ym', true],
      ['ozon', false],
      ['wb', false],
    ]);
    expect(await availability({ ozon: true })).toEqual([
      ['ym', true],
      ['ozon', true],
      ['wb', false],
    ]);
  });

  it('без входа — 401', async () => {
    const { base } = await boot();
    const response = await fetch(`${base}/api/crm/marketplaces`);
    expect(response.status).toBe(401);
  });
});

/** Заказ ЯМ в общем формате (TASK-130): деньги, день и этап — функциями отчётов. */
describe('ymMarketplaceOrder', () => {
  it('продажи — orderTotals (с субсидиями), день — по Москве, схема прописными', () => {
    const order = ymMarketplaceOrder(
      {
        id: 58841189889,
        status: 'PROCESSING',
        substatus: 'READY_TO_SHIP',
        creationDate: '17-10-2026 23:40:00',
        itemsTotal: 1000,
        subsidies: [{ type: 'YANDEX_CASHBACK', amount: 150 }, { type: 'DELIVERY', amount: 99 }],
        items: [{ offerId: ' F-91W ', offerName: 'Casio', count: 2, price: 500 }],
      } as never,
      'fbs',
    );
    expect(order).toEqual({
      marketplace: 'ym',
      id: '58841189889',
      orderNumber: '58841189889',
      scheme: 'FBS',
      stage: 'assembled',
      status: 'PROCESSING',
      substatus: 'READY_TO_SHIP',
      createdDay: '2026-10-17',
      items: [{ sku: 'F-91W', name: 'Casio', count: 2, price: 500 }],
      sales: 1150,
    });
  });
});
