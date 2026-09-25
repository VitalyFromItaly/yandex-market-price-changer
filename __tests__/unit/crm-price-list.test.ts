import type { INestApplication } from '@nestjs/common';
import type { ICrmStockSyncJob } from '../../src/modules/telegram/queue/processors/stock-sync.processor';

import { getQueueToken } from '@nestjs/bull';
import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { CrmJobResult } from '../../src/database/schemas/crm-job-result.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { CrmJobResultService } from '../../src/database/services/crm-job-result.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmPriceListController } from '../../src/modules/crm/price-list/crm-price-list.controller';
import { decodeFileName } from '../../src/modules/crm/price-list/crm-price-list.domain';
import { PriceListUploadInterceptor } from '../../src/modules/crm/price-list/price-list-upload.interceptor';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../src/modules/telegram';
import { BotRegistry } from '../../src/modules/telegram/bots/bot-registry.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { StockSyncProcessor } from '../../src/modules/telegram/queue/processors/stock-sync.processor';
import { StockSyncService } from '../../src/modules/yandex/stocks/stock-sync.service';
import { StockUploadPolicyService } from '../../src/modules/yandex/stocks/stock-upload-policy.service';
import { storeKeyOf } from '../../src/modules/yandex/stores/stores.domain';
import { StoresService } from '../../src/modules/yandex/stores/stores.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
/** Метка внутри «файла»: ни в Redis, ни в журнале её быть не должно. */
const FILE_MARKER = 'SECRET-PRICE-LIST-CONTENT';
/** Ключ активного магазина всех продавцов теста (campaign 12345678). */
const STORE_KEY = storeKeyOf('12345678');
/** Второй магазин продавца 666 — FBY, НЕ активный в боте. */
const FBY_KEY = storeKeyOf('87654321');

/**
 * Загрузка прайса из CRM на настоящем HTTP (multer внутри). Очередь
 * поддельная: `add` запоминает payload, процессор тест зовёт сам — как Bull.
 * Сам `StockSyncService` — заглушка: что на FBY остатки не пишутся, доказывает
 * stocks-sync.test.ts; здесь — что CRM доводит до него правильные опции, файл
 * и ничего лишнего не кладёт в Redis.
 */
describe('Прайс в CRM по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let results: ReturnType<typeof inMemoryModel>;
  let logs: ReturnType<typeof inMemoryModel>;
  let processor: StockSyncProcessor;
  const queueAdd = vi.fn();
  const sync = vi.fn();
  const placementFor = vi.fn(async () => undefined as string | undefined);
  const list = vi.fn();

  const seller = (telegramUserId: string, username: string, features = {}) => ({
    telegramUserId,
    botId: '999',
    status: 'approved',
    username,
    features,
  });
  const storeOf = (telegramUserId: string, placementType: string) => ({
    telegramUserId,
    campaign_id: '12345678',
    business_id: '1',
    token: 'ACMA:secret-token',
    stores: [{ campaignId: '12345678', businessId: '1', placementType }],
    discountPercent: 10,
  });

  beforeEach(async () => {
    queueAdd.mockReset();
    queueAdd.mockResolvedValue({ id: 1 });
    sync.mockReset();
    placementFor.mockClear();
    list.mockReset();
    results = inMemoryModel();
    results.uniqueBy('activeKey');
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
        CrmJobResultService,
        UserAccessService,
        YandexMarketService,
        { provide: getModelToken(ActionLog.name), useValue: logs },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(CrmJobResult.name), useValue: results },
        {
          provide: getModelToken(UserAccess.name),
          useValue: inMemoryModel([
            seller('222', 'fbs'),
            seller('333', 'fby'),
            seller('444', 'noprices', { [FEATURE.PURCHASE_PRICES]: false }),
            seller('555', 'nothing', {
              [FEATURE.PURCHASE_PRICES]: false,
              [FEATURE.STOCK_UPDATE]: false,
            }),
            seller('666', 'two'),
          ]),
        },
        {
          provide: getModelToken(YandexMarket.name),
          useValue: inMemoryModel([
            storeOf('222', 'FBS'),
            storeOf('333', 'FBY'),
            storeOf('444', 'FBS'),
            storeOf('555', 'FBS'),
            {
              ...storeOf('666', 'FBS'),
              stores: [
                { campaignId: '12345678', businessId: '1', placementType: 'FBS' },
                { campaignId: '87654321', businessId: '2', placementType: 'FBY' },
              ],
            },
          ]),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.FILE_PROCESSING),
          useValue: {
            add: queueAdd,
            getWaitingCount: async () => 1,
            getActiveCount: async () => 0,
          },
        },
        { provide: ErrorReporter, useValue: { report: async () => undefined } },
        { provide: PurchasePriceService, useValue: { list, lastUpdatedAt: async () => null } },
        {
          provide: AppConfigService,
          useValue: {
            isAdmin: () => false,
            crmInitialPassword: INITIAL,
            stockWriteEnabled: true,
          },
        },
      ],
      exports: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        CrmJobResultService,
        UserAccessService,
        YandexMarketService,
        ErrorReporter,
        PurchasePriceService,
        AppConfigService,
        getQueueToken(QUEUE_NAMES.FILE_PROCESSING),
      ],
    })
    class FakeDatabaseModule {}

    // Из частей, а не импортом CrmPriceListModule: тот тянет TelegramModule со
    // всем графом бота. Процессор — настоящий, реестр ботов ему не понадобится.
    @Module({
      imports: [CrmModule],
      controllers: [CrmPriceListController],
      providers: [
        PriceListUploadInterceptor,
        StockUploadPolicyService,
        StockSyncProcessor,
        StoresService,
        // Кэш магазинов у всех заполнен — Маркет список не спрашивают.
        { provide: YandexClientFactory, useValue: { forTokenOnly: () => ({ listStores: list }) } },
        { provide: StockSyncService, useValue: { sync, placementFor } },
        { provide: BotRegistry, useValue: { findByTelegramId: () => undefined } },
      ],
    })
    class PriceListUnderTest {}

    const moduleRef = await Test.createTestingModule({ imports: [PriceListUnderTest] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();
    processor = moduleRef.get(StockSyncProcessor);

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterEach(async () => {
    await app.close();
  });

  async function tokenOf(login: string): Promise<string> {
    const first = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password: INITIAL }),
    });
    const { token } = (await first.json()) as { token: string };
    const changed = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    return ((await changed.json()) as { token: string }).token;
  }

  function upload(
    token: string,
    name = 'прайс.xlsx',
    content: Uint8Array = Buffer.from(FILE_MARKER),
    dryRun = false,
    store: string | null = STORE_KEY,
  ): Promise<Response> {
    const form = new FormData();
    form.append('dryRun', String(dryRun));
    if (store !== null) form.append('store', store);
    form.append('file', new Blob([content]), name);
    return fetch(`${base}/api/crm/ym/price-list/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  }

  const lastPayload = () => queueAdd.mock.calls.at(-1)?.[1] as ICrmStockSyncJob;

  it('файл больше 10 МБ → 413 с кодом и русским текстом, в очередь ничего', async () => {
    const token = await tokenOf('fbs');
    const response = await upload(token, 'big.xlsx', new Uint8Array(10 * 1024 * 1024 + 1));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'FILE_TOO_LARGE', field: 'file' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('не Excel → 400 INVALID_FILE под полем file', async () => {
    const token = await tokenOf('fbs');
    const response = await upload(token, 'stock.csv');

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; field: string; message: string };
    expect(body).toMatchObject({ code: 'INVALID_FILE', field: 'file' });
    expect(body.message).toContain('stock.csv');
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('обе фичи выключены → 403, файл не принят', async () => {
    const token = await tokenOf('nothing');
    const response = await upload(token);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('FBS: в очередь file-processing — SYNC_STOCKS без буфера и токена', async () => {
    const token = await tokenOf('fbs');
    const response = await upload(token);

    expect(response.status).toBe(202);
    const accepted = (await response.json()) as { jobId: string; warning: unknown; ahead: number };
    expect(accepted.warning).toBeNull();
    expect(accepted.ahead).toBe(1);

    const [name, payload, options] = queueAdd.mock.calls[0];
    expect(name).toBe(JOB_TYPES.SYNC_STOCKS);
    expect(options).toEqual({ attempts: 1, jobId: accepted.jobId });
    expect(payload).toEqual({
      source: 'crm',
      jobId: accepted.jobId,
      telegramUserId: '222',
      fileName: 'прайс.xlsx',
      dryRun: false,
      savePurchasePrices: true,
      stockWriteAllowed: true,
      campaignId: '12345678',
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(FILE_MARKER);
    expect(serialized).not.toContain('secret-token');
    // Модель — из кэша stores: Маркет не спрашивали.
    expect(placementFor).not.toHaveBeenCalled();
  });

  it('FBY: предупреждение до обработки, закуп сохраняется, запись остатков — нет', async () => {
    sync.mockResolvedValue({
      totalRows: 3,
      matched: 2,
      zeroed: 0,
      updated: 0,
      skipped: [],
      matchedBy: {},
      errors: [],
      dryRun: false,
      catalogSize: 10,
      purchasePricesSaved: 3,
      placementType: 'FBY',
      writeSkipReason: 'placement',
    });
    const token = await tokenOf('fby');
    const response = await upload(token);

    expect(response.status).toBe(202);
    const accepted = (await response.json()) as {
      jobId: string;
      warning: { code: string; text: string };
      progress: string;
    };
    expect(accepted.warning.code).toBe('fby');
    // Текст CRM — без HTML и с указанием на список магазинов, не на кнопку бота.
    expect(accepted.warning.text).not.toContain('<b>');
    expect(accepted.warning.text).toContain('«Магазины»');
    expect(accepted.progress).toContain('остатки не трогаю');

    await processor.run({ data: lastPayload() } as never);

    // Барьер последнего рубежа — в sync: ему пришли файл и опции продавца.
    const [credentials, buffer, options] = sync.mock.calls[0];
    expect(credentials).toMatchObject({ campaignId: '12345678' });
    expect(Buffer.from(buffer).toString()).toBe(FILE_MARKER);
    expect(options).toMatchObject({
      telegramUserId: '333',
      savePurchasePrices: true,
      dryRun: false,
    });

    const job = (await results.findOne({ jobId: accepted.jobId }).exec()) as Record<
      string,
      unknown
    >;
    expect(job.status).toBe('done');
    expect(job.input).toBeUndefined();
    expect(job.data).toMatchObject({
      writeSkipReason: 'placement',
      purchasePricesSaved: 3,
      updated: null,
    });
    expect((job.data as { headline: string }).headline).not.toContain('<b>');
  });

  it('без магазина → 400, с чужим ключом → 404; в очередь ничего', async () => {
    const token = await tokenOf('fbs');

    expect((await upload(token, 'прайс.xlsx', Buffer.from(FILE_MARKER), false, null)).status).toBe(
      400,
    );
    const foreign = await upload(token, 'прайс.xlsx', Buffer.from(FILE_MARKER), false, FBY_KEY);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: 'STORE_NOT_FOUND' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('прайс в НЕ активный магазин: модель и склад — его, активный магазин бота не тронут', async () => {
    sync.mockResolvedValue({
      totalRows: 1,
      matched: 1,
      zeroed: 0,
      updated: 0,
      skipped: [],
      matchedBy: {},
      errors: [],
      dryRun: false,
      catalogSize: 1,
      purchasePricesSaved: 1,
      placementType: 'FBY',
      writeSkipReason: 'placement',
    });
    const token = await tokenOf('two');
    const response = await upload(token, 'прайс.xlsx', Buffer.from(FILE_MARKER), false, FBY_KEY);

    expect(response.status).toBe(202);
    // Активный в боте — FBS, но предупреждение про FBY: решает открытый магазин.
    const accepted = (await response.json()) as { warning: { code: string } };
    expect(accepted.warning.code).toBe('fby');
    expect(lastPayload().campaignId).toBe('87654321');

    await processor.run({ data: lastPayload() } as never);
    expect(sync.mock.calls[0][0]).toMatchObject({ campaignId: '87654321', businessId: '2' });

    const stores = app.get(YandexMarketService);
    expect((await stores.findByTelegramUser('666'))?.campaign_id).toBe('12345678');
  });

  it('статус задачи не тянет входной файл', async () => {
    const token = await tokenOf('fbs');
    const { jobId } = (await (await upload(token)).json()) as { jobId: string };

    const stored = (await results.findOne({ jobId }).exec()) as Record<string, unknown>;
    expect(stored.input).toBeDefined();

    const service = app.get(CrmJobResultService);
    const own = (await service.findOwn(jobId, '222')) as unknown as Record<string, unknown>;
    expect(own.input).toBeUndefined();
  });

  it('второй файл во время обработки первого → 409 с jobId идущей задачи', async () => {
    const token = await tokenOf('fbs');
    const first = (await (await upload(token)).json()) as { jobId: string };
    const second = await upload(token);

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'UPLOAD_RUNNING', jobId: first.jobId });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('сбой обработки → failed с текстом, замок снят', async () => {
    sync.mockRejectedValue(new Error('boom'));
    const token = await tokenOf('fbs');
    const { jobId } = (await (await upload(token)).json()) as { jobId: string };

    await processor.run({ data: lastPayload() } as never);

    const job = (await results.findOne({ jobId }).exec()) as Record<string, unknown>;
    expect(job.status).toBe('failed');
    expect(String(job.error)).toContain('Не удалось обработать файл');
    expect(job.activeKey).toBeUndefined();
    expect(job.input).toBeUndefined();
  });

  it('журнал CRM не содержит тела запроса', async () => {
    const token = await tokenOf('fbs');
    await upload(token);
    // Журнал пишется на `finish` — дать событию дойти.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const rows = await logs.find({}).exec();
    expect(rows.some((row) => String(row.action ?? '').includes('price-list/upload'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(FILE_MARKER);
  });

  describe('закупочные цены', () => {
    it('без purchase_prices → 403', async () => {
      const token = await tokenOf('noprices');
      const response = await fetch(`${base}/api/crm/ym/price-list/purchase-prices`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(403);
      expect(list).not.toHaveBeenCalled();
    });

    it('страница с поиском и закупом после скидки', async () => {
      list.mockResolvedValue({
        items: [{ sku: 'A-1', price: 1000, name: 'Часы', category: 'X' }],
        total: 1,
      });
      const token = await tokenOf('fbs');
      const response = await fetch(
        `${base}/api/crm/ym/price-list/purchase-prices?q=a-1&page=2&limit=500`,
        { headers: { authorization: `Bearer ${token}` } },
      );

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith('222', { q: 'a-1', page: 2, limit: 500 });
      const body = (await response.json()) as { items: { cost: number }[]; limit: number };
      // Скидка по умолчанию 10 % — закуп 900, как его считает «Прибыль».
      expect(body.items[0].cost).toBe(900);
      expect(body.limit).toBe(100);
    });
  });
});

describe('decodeFileName', () => {
  it('кириллица из latin1 заголовка multipart', () => {
    const garbled = Buffer.from('прайс.xlsx', 'utf8').toString('latin1');
    expect(decodeFileName(garbled)).toBe('прайс.xlsx');
  });

  it('ASCII не меняется', () => {
    expect(decodeFileName('stock.xlsx')).toBe('stock.xlsx');
  });
});
