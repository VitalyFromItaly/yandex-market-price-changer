import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as XLSX from 'xlsx';
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
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AccountingCostHistoryService } from '../../src/modules/accounting/accounting-cost-history.service';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import { AccountingReconcileService } from '../../src/modules/accounting/accounting-reconcile.service';
import { AccountingTaxSettingsService } from '../../src/modules/accounting/accounting-tax-settings.service';
import { AccountingCostSettingsService } from '../../src/modules/accounting/accounting-cost-settings.service';
import { AccountingLotCostService } from '../../src/modules/accounting/accounting-lot-cost.service';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { ProductCatalogService } from '../../src/modules/products/product-catalog.service';
import { CrmAccountingController } from '../../src/modules/crm/accounting/crm-accounting.controller';
import { NOT_CONNECTED } from '../../src/modules/crm/connections/crm-connections.domain';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import {
  FINANCE_FILE_UNRECOGNIZED,
  INVALID_FINANCE_REQUEST,
} from '../../src/modules/crm/finance/crm-finance.domain';
import { financeToday } from '../../src/modules/finance/finance-period';
import { screenMonths } from '../../src/modules/finance/finance-screen';
import { NettingFileError } from '../../src/modules/finance/ym-netting-file';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { WbFinanceService } from '../../src/modules/wb/wb-finance.service';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { inMemoryModel } from '../helpers/in-memory-model';

/**
 * Маршрут загрузки отчёта WB «Продвижение» (TASK-209): только доставка —
 * фичи, проверка файла и месяца, коды отказов. Сам импорт — в
 * finance-wb-promotion-upload.test.ts на PGlite.
 */

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';

describe('CRM «Финучёт» — POST uploads/wb-promotion', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  let importPromotionFile: ReturnType<typeof vi.fn>;
  const lotsWithRemaining = vi.fn(async () => [
    {
      id: 'L1',
      purchaseId: 'P1',
      supplier: 'ООО Восток',
      receivedDay: '2026-10-01',
      sku: 'A1',
      name: 'Часы',
      productId: 'product-a1',
      count: 3,
      remaining: 1,
      unitPriceKopecks: 100_000,
      extraKopecks: 1_000,
    },
  ]);

  const catalogList = vi.fn(async () => ({
    total: 1,
    totalAll: 5,
    page: 1,
    limit: 20,
    brands: [],
    items: [
      {
        id: 'product-a1',
        internalSku: 'A1',
        name: 'Часы',
        purchase: { price: 900, currency: 'RUR', rate: null, extraCosts: null },
        cost: 900,
      },
    ],
  }));

  afterEach(async () => {
    await app?.close();
  });

  async function boot(features: Record<string, boolean>) {
    importPromotionFile = vi.fn(async () => ({
      status: 'imported',
      rows: 2,
      inserted: 2,
      matched: 0,
      skippedSuperseded: 0,
      unknown: 0,
    }));
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      { telegramUserId: SELLER_ID, campaign_id: '1', business_id: '2', token: 'SECRET' },
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
        MarketplaceConnectionService,
        { provide: getModelToken(MarketplaceConnection.name), useValue: inMemoryModel() },
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
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
        MarketplaceConnectionService,
        PurchasePriceService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmAccountingController],
      providers: [
        { provide: AccountingReconcileService, useValue: {} },
        { provide: AccountingManualOperationsService, useValue: {} },
        { provide: AccountingCostHistoryService, useValue: {} },
        { provide: AccountingTaxSettingsService, useValue: {} },
        { provide: AccountingCostSettingsService, useValue: {} },
        { provide: AccountingLotCostService, useValue: { lotsWithRemaining } },
        { provide: AccountingService, useValue: { status: () => ({ ready: false }) } },
        { provide: WbFinanceService, useValue: { importPromotionFile } },
        { provide: ProductCatalogService, useValue: { list: catalogList } },
      ],
    })
    class AccountingTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AccountingTestModule] })
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

  /** Прошлый месяц от сегодняшнего: тест не протухает через год. */
  const uploadMonth = () => screenMonths(financeToday(new Date()))[1].month;

  const xlsx = () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['ID кампании', 'Дата списания', 'Сумма'],
        ['1', '05.09.2026', '10'],
      ]),
      'Лист1',
    );
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  function upload(name: string, content: Uint8Array, month: string | null = uploadMonth()) {
    const form = new FormData();
    if (month !== null) form.append('month', month);
    form.append('file', new Blob([content]), name);
    return fetch(`${base}/api/crm/ym/accounting/uploads/wb-promotion`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  }

  const codeOf = async (response: Response) => ((await response.json()) as { code: string }).code;

  it('только зонтик, без fin_accounting_uploads — 403 FEATURE_DISABLED', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true });
    const response = await upload('promo.xlsx', xlsx());
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe(FEATURE_DISABLED);
    expect(importPromotionFile).not.toHaveBeenCalled();
  });

  it('зонтик и подфича — итог загрузки; файл и месяц продавца уходят в импорт', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_UPLOADS]: true });
    const response = await upload('Продвижение.xlsx', xlsx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'imported',
      month: uploadMonth(),
      rows: 2,
      inserted: 2,
      matched: 0,
    });
    const [seller, period, file] = importPromotionFile.mock.calls[0];
    expect(seller).toBe(SELLER_ID);
    expect(period.from.startsWith(uploadMonth())).toBe(true);
    expect(file.filename).toBe('Продвижение.xlsx');

    importPromotionFile.mockResolvedValueOnce({ status: 'unchanged', rows: 2 });
    expect(await (await upload('Продвижение.xlsx', xlsx())).json()).toEqual({
      status: 'unchanged',
      month: uploadMonth(),
      rows: 2,
    });
  });

  it('отказы: расширение, месяц, нераспознанный файл, WB не подключён', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_UPLOADS]: true });
    const pdf = await upload('promo.pdf', new Uint8Array([1]));
    expect(pdf.status).toBe(400);

    const month = await upload('promo.xlsx', xlsx(), '2020-01');
    expect(month.status).toBe(400);
    expect(await codeOf(month)).toBe(INVALID_FINANCE_REQUEST);

    importPromotionFile.mockRejectedValueOnce(
      new NettingFileError('unrecognized', 'не нашли', { missing: ['ID кампании'] }),
    );
    const unknown = await upload('promo.xlsx', xlsx());
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      code: FINANCE_FILE_UNRECOGNIZED,
      missing: ['ID кампании'],
    });

    importPromotionFile.mockRejectedValueOnce(new WbNotConnectedError(SELLER_ID));
    const noWb = await upload('promo.xlsx', xlsx());
    expect(noWb.status).toBe(409);
    expect(await codeOf(noWb)).toBe(NOT_CONNECTED);
  });

  it('партии (TASK-216): без fin_accounting_lots — 403; с ней — остатки и цена с доп. расходами', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true });
    const lotsUrl = () => `${base}/api/crm/ym/accounting/lots`;
    const closed = await fetch(lotsUrl(), { headers: { authorization: `Bearer ${token}` } });
    expect(closed.status).toBe(403);
    expect(await codeOf(closed)).toBe(FEATURE_DISABLED);
    await app.close();

    await boot({ [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_LOTS]: true });
    const open = await fetch(lotsUrl(), { headers: { authorization: `Bearer ${token}` } });
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({
      lots: [
        {
          lotId: 'L1',
          purchaseId: 'P1',
          supplier: 'ООО Восток',
          receivedDay: '2026-10-01',
          sku: 'A1',
          name: 'Часы',
          productMatched: true,
          count: 3,
          remaining: 1,
          unitPriceKopecks: 100_000,
          extraKopecks: 1_000,
          unitCostKopecks: 100_333,
          remainingCostKopecks: 100_333,
        },
      ],
      totals: { remaining: 1, remainingCostKopecks: 100_333 },
    });
    expect(lotsWithRemaining).toHaveBeenCalledWith(SELLER_ID);
  });

  it('поиск товара истории закупа — под одним зонтиком, без закупа, q обрезан', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true });
    const long = 'я'.repeat(300);
    const response = await fetch(
      `${base}/api/crm/ym/accounting/cost-history/products?q=${encodeURIComponent(`  ${long} `)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      total: 1,
      items: [{ id: 'product-a1', internalSku: 'A1', name: 'Часы' }],
      currencies: ['RUR', 'USD', 'EUR', 'CNY'],
    });
    expect(catalogList).toHaveBeenLastCalledWith(SELLER_ID, {
      q: 'я'.repeat(200),
      brand: null,
      page: 1,
      limit: 20,
    });
  });

  it('поиск товара без зонтика — 403', async () => {
    await boot({});
    const response = await fetch(`${base}/api/crm/ym/accounting/cost-history/products`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
  });
});
