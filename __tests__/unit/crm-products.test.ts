import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CostHistory } from '../../src/database/schemas/cost-history.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { ProductCardIssue } from '../../src/database/schemas/product-card-issue.schema';
import { Product } from '../../src/database/schemas/product.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CostHistoryService } from '../../src/database/services/cost-history.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { ProductCardIssueService } from '../../src/database/services/product-card-issue.service';
import { ProductService } from '../../src/database/services/product.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmProductsModule } from '../../src/modules/crm/products/crm-products.module';
import {
  INVALID_PURCHASE,
  PRODUCT_NOT_FOUND,
  PRODUCT_PURCHASE_KIND,
} from '../../src/modules/crm/products/crm-products.domain';
import { costsOn } from '../../src/modules/products/cost-history.domain';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { ratesOf } from '../../src/modules/yandex/reports/profit';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';
const OTHER_ID = '333';

interface ICard {
  id: string;
  internalSku: string;
  cost: number | null;
  purchase: { price: number; currency: string; rate: number | null; extraCosts: number | null };
  history: { validFrom: string | null; source: string; author: string | null }[];
  links: { marketplace: string; sku: string | null; source: string | null }[];
}

/**
 * «Товары» CRM (TASK-118) на настоящем HTTP: гейт фичи, правка закупа с
 * историей и автором, одна себестоимость с «Прайсом», ручная привязка.
 */
describe('CRM «Товары» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  let products: ReturnType<typeof inMemoryModel>;
  let history: ReturnType<typeof inMemoryModel>;
  let issues: ReturnType<typeof inMemoryModel>;
  let logs: ReturnType<typeof inMemoryModel>;
  let costHistory: CostHistoryService;

  async function boot(features: Record<string, boolean> = { [FEATURE.PRODUCTS]: true }) {
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        campaign_id: '12345678',
        business_id: '87654321',
        token: 'SECRET-TOKEN',
        discountPercent: 10,
      },
    ]);
    products = inMemoryModel([
      {
        _id: 'p-casio',
        telegramUserId: SELLER_ID,
        internalSku: 'GA-100',
        name: 'Casio G-Shock',
        marketplaceSkus: { ym: 'GA-100' },
        marketplaceLinks: { ym: { source: 'seed', linkedAt: new Date('2026-10-01') } },
        purchase: { price: 1000, currency: 'RUR' },
      },
      {
        _id: 'p-strap',
        telegramUserId: SELLER_ID,
        internalSku: 'STRAP',
        name: 'Ремешок',
        purchase: { price: 200, currency: 'RUR' },
      },
      { _id: 'p-alien', telegramUserId: OTHER_ID, internalSku: 'X', name: 'Чужой' },
    ]);
    products.uniqueBy('telegramUserId', 'marketplaceSkus.ym');
    history = inMemoryModel();
    issues = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        marketplace: 'ozon',
        sku: 'OZ-1',
        name: 'Ремешок Ozon',
        reason: 'conflict',
        level: 'barcode',
        candidateIds: ['p-strap'],
        detectedAt: new Date('2026-10-16'),
      },
      {
        telegramUserId: OTHER_ID,
        marketplace: 'ozon',
        sku: 'OZ-ALIEN',
        reason: 'no_match',
        candidateIds: [],
        detectedAt: new Date('2026-10-16'),
      },
    ]);
    issues.uniqueBy('telegramUserId', 'marketplace', 'sku');
    logs = inMemoryModel();
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
        ProductService,
        CostHistoryService,
        ProductCardIssueService,
        { provide: getModelToken(ActionLog.name), useValue: logs },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        { provide: getModelToken(Product.name), useValue: products },
        { provide: getModelToken(CostHistory.name), useValue: history },
        { provide: getModelToken(ProductCardIssue.name), useValue: issues },
        { provide: PurchasePriceService, useValue: {} },
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
        ProductService,
        CostHistoryService,
        ProductCardIssueService,
        PurchasePriceService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    const moduleRef = await Test.createTestingModule({ imports: [CrmProductsModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();
    costHistory = moduleRef.get(CostHistoryService);

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
    return fetch(`${base}/api/crm/ym/products${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await app?.close();
  });

  it('фича выключена — 403 FEATURE_DISABLED на чтении и записи', async () => {
    await boot({});
    for (const [method, path, body] of [
      ['GET', ''],
      ['GET', '/unmatched'],
      ['GET', '/p-casio'],
      ['PUT', '/p-casio/purchase', { price: 1 }],
      ['POST', '/p-casio/links', { marketplace: 'ozon', sku: 'OZ-1' }],
    ] as const) {
      const response = await call(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
    }
    expect(history.documents).toEqual([]);
  });

  it('список: только свои товары, поиск, бренд, без telegramUserId в ответе', async () => {
    await boot();
    const all = (await (await call('GET', '')).json()) as {
      total: number;
      items: { internalSku: string; cost: number }[];
      brands: { key: string; count: number }[];
    };
    expect(all.total).toBe(2);
    expect(all.items.map((item) => item.internalSku)).toEqual(['GA-100', 'STRAP']);
    expect(all.brands.map((brand) => brand.key)).toEqual(['casio', 'none']);
    expect(JSON.stringify(all)).not.toContain(SELLER_ID);

    const casio = (await (await call('GET', '?brand=casio')).json()) as { total: number };
    expect(casio.total).toBe(1);
    const found = (await (await call('GET', '?q=ремеш')).json()) as {
      items: { internalSku: string }[];
    };
    expect(found.items.map((item) => item.internalSku)).toEqual(['STRAP']);
  });

  it('карточка: чужой и мусорный id — 404 PRODUCT_NOT_FOUND', async () => {
    await boot();
    for (const id of ['p-alien', 'nope']) {
      const response = await call('GET', `/${id}`);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe(PRODUCT_NOT_FOUND);
    }
  });

  it('правка закупа: стартовая со старым закупом, запись дня с автором; себестоимость = «Прайс»', async () => {
    await boot();
    const bad = await call('PUT', '/p-casio/purchase', { price: 10, currency: 'USD' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: INVALID_PURCHASE, field: 'rate' });
    expect(history.documents).toEqual([]);

    const response = await call('PUT', '/p-casio/purchase', {
      price: '12,5',
      currency: 'USD',
      rate: 90,
      extraCosts: 40,
    });
    expect(response.status).toBe(200);
    const card = (await response.json()) as ICard;

    expect(card.purchase).toEqual({ price: 12.5, currency: 'USD', rate: 90, extraCosts: 40 });
    // 12,5 × 90 = 1125, минус скидка 10 % = 1012,5, плюс 40.
    expect(card.cost).toBeCloseTo(1052.5, 6);
    expect(card.history.map((row) => [row.source, row.author])).toEqual([
      ['manual', SELLER_ID],
      ['baseline', null],
    ]);

    // «Прайс» считает тем же costOn по истории артикула ЯМ.
    const histories = await costHistory.findForSkus(SELLER_ID, ['GA-100']);
    const price = costsOn(
      new Map([['GA-100', { price: 1000, name: 'Casio G-Shock' }]]),
      histories,
      ratesOf({ discountPercent: 10 }),
      new Date(),
    ).get('GA-100');
    expect(price).toBe(card.cost);

    expect(logs.documents.some((doc) => doc.kind === PRODUCT_PURCHASE_KIND)).toBe(true);

    // Повтор того же закупа — новых записей нет.
    await call('PUT', '/p-casio/purchase', {
      price: 12.5,
      currency: 'USD',
      rate: 90,
      extraCosts: 40,
    });
    expect(history.documents).toHaveLength(2);
  });

  it('очередь «не сопоставлено» — только своя; привязка снимает строку, отвязка возвращает', async () => {
    await boot();
    const queue = (await (await call('GET', '/unmatched')).json()) as {
      total: number;
      items: { sku: string; candidates: { internalSku: string }[] }[];
    };
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({ sku: 'OZ-1', candidates: [{ internalSku: 'STRAP' }] });
    expect(JSON.stringify(queue)).not.toContain(OTHER_ID);

    const linked = await call('POST', '/p-strap/links', { marketplace: 'ozon', sku: 'OZ-1' });
    expect(linked.status).toBe(200);
    const card = (await linked.json()) as ICard;
    expect(card.links.find((link) => link.marketplace === 'ozon')).toMatchObject({
      sku: 'OZ-1',
      source: 'manual',
    });
    expect(((await (await call('GET', '/unmatched')).json()) as { total: number }).total).toBe(0);

    const second = await call('POST', '/p-strap/links', { marketplace: 'ozon', sku: 'OZ-2' });
    expect(second.status).toBe(409);

    const unlinked = await call('DELETE', '/p-strap/links/ozon');
    expect(unlinked.status).toBe(200);
    expect(((await (await call('GET', '/unmatched')).json()) as { total: number }).total).toBe(1);

    expect(
      (await call('POST', '/p-alien/links', { marketplace: 'ozon', sku: 'OZ-1' })).status,
    ).toBe(404);
    expect((await call('POST', '/p-strap/links', { marketplace: 'avito', sku: 'A' })).status).toBe(
      400,
    );
  });
});
