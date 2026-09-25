import type { INestApplication } from '@nestjs/common';
import type { ICrmJobPayload } from '../../src/modules/crm/jobs/crm-jobs.domain';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getQueueToken } from '@nestjs/bull';
import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

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
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { CrmModule } from '../../src/modules/crm/crm.module';
import {
  contentDisposition,
  CrmJobsController,
} from '../../src/modules/crm/jobs/crm-jobs.controller';
import {
  CRM_JOBS_CONCURRENCY,
  CrmJobError,
  MAX_RESULT_BYTES,
} from '../../src/modules/crm/jobs/crm-jobs.domain';
import { CrmJobsProcessor } from '../../src/modules/crm/jobs/crm-jobs.processor';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import { JOB_TYPES, QUEUE_NAMES } from '../../src/modules/telegram';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { storeKeyOf } from '../../src/modules/yandex/stores/stores.domain';
import { StoresService } from '../../src/modules/yandex/stores/stores.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
/** Активный магазин бота у обоих продавцов. */
const STORE_KEY = storeKeyOf('12345678');
/** Второй магазин Васи — FBY, в боте НЕ активный. */
const FBY_KEY = storeKeyOf('87654321');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function testWorkbook(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Артикул'], ['A-1']]), 'Лист');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Фоновые задачи CRM на настоящем HTTP. Очередь поддельная: `add` только
 * запоминает payload, а процессор тест зовёт сам — так видно каждое состояние
 * между постановкой и результатом, без Redis и без гонок.
 */
describe('CrmJobs по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let results: ReturnType<typeof inMemoryModel>;
  let processor: CrmJobsProcessor;
  let registry: CrmJobsRegistry;
  const queueAdd = vi.fn();
  const report = vi.fn(async () => undefined);

  const seller = (telegramUserId: string, username: string) => ({
    telegramUserId,
    botId: '999',
    status: 'approved',
    username,
    features: { [FEATURE.PAYMENTS_REPORT]: false },
  });
  const storeOf = (telegramUserId: string) => ({
    telegramUserId,
    campaign_id: '12345678',
    business_id: '1',
    token: 't',
    stores: [
      { campaignId: '12345678', businessId: '1', placementType: 'FBS' },
      ...(telegramUserId === '222'
        ? [{ campaignId: '87654321', businessId: '2', storeName: 'fby.ru', placementType: 'FBY' }]
        : []),
    ],
  });

  beforeEach(async () => {
    queueAdd.mockReset();
    report.mockClear();
    results = inMemoryModel();
    results.uniqueBy('activeKey');
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
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(CrmJobResult.name), useValue: results },
        {
          provide: getModelToken(UserAccess.name),
          useValue: inMemoryModel([seller('222', 'Vasya'), seller('333', 'Petya')]),
        },
        {
          provide: getModelToken(YandexMarket.name),
          useValue: inMemoryModel([storeOf('222'), storeOf('333')]),
        },
        { provide: getQueueToken(QUEUE_NAMES.CRM_JOBS), useValue: { add: queueAdd } },
        { provide: ErrorReporter, useValue: { report } },
        {
          provide: AppConfigService,
          useValue: { isAdmin: () => false, crmInitialPassword: INITIAL },
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
        AppConfigService,
        getQueueToken(QUEUE_NAMES.CRM_JOBS),
      ],
    })
    class FakeDatabaseModule {}

    // Модуль собирается из частей, а не импортом CrmJobsModule: тот тянет
    // TelegramModule со всем графом бота, а предмет теста — только задачи.
    @Module({
      imports: [CrmModule],
      controllers: [CrmJobsController],
      providers: [
        CrmJobsRegistry,
        CrmJobsProcessor,
        StoresService,
        // Кэш магазинов заполнен — Маркет список не спрашивают.
        {
          provide: YandexClientFactory,
          useValue: { forTokenOnly: () => ({ listStores: vi.fn() }) },
        },
      ],
    })
    class JobsUnderTest {}

    const moduleRef = await Test.createTestingModule({ imports: [JobsUnderTest] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    registry = moduleRef.get(CrmJobsRegistry);
    processor = moduleRef.get(CrmJobsProcessor);
    registry.register('test-xlsx', {
      features: [],
      run: async ({ params, features }) => ({
        data: { rows: 1, echo: params, payments: features[FEATURE.PAYMENTS_REPORT] },
        file: { buffer: testWorkbook(), filename: 'отчёт-тест.xlsx', contentType: XLSX_TYPE },
      }),
    });

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

  /** POST без явного `store` — активный магазин бота (ключ STORE_KEY). */
  const api = (token: string, path: string, body?: Record<string, unknown>) =>
    fetch(`${base}/api/crm/ym/jobs${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify({ store: STORE_KEY, ...body }),
    });

  /** Прогнать последнюю поставленную задачу, как это сделал бы Bull. */
  async function runLast(): Promise<void> {
    const [, data] = queueAdd.mock.calls.at(-1) as [string, ICrmJobPayload];
    await processor.run({ data } as never);
  }

  it('POST → queued → done, /file отдаёт xlsx с кириллическим именем', async () => {
    const token = await tokenOf('vasya');
    const started = await api(token, '', { kind: 'test-xlsx', params: { period: 'month' } });
    expect(started.status).toBe(202);
    const { jobId, created } = (await started.json()) as { jobId: string; created: boolean };
    expect(created).toBe(true);

    // В очередь — без токена и с тем же id, что в Mongo.
    expect(queueAdd).toHaveBeenCalledWith(
      JOB_TYPES.RUN_CRM_JOB,
      {
        jobId,
        telegramUserId: '222',
        kind: 'test-xlsx',
        params: { period: 'month' },
        // Снимок фич едет в payload: kind не читает UserAccess сам (у админа
        // записи нет), а явное решение панели обязано дойти до задачи.
        features: expect.objectContaining({
          [FEATURE.PAYMENTS_REPORT]: false,
          [FEATURE.REPORT_REDEEMED]: true,
        }),
        // Магазин, открытый в вебе, — id кампании, а не ключ из URL.
        campaignId: '12345678',
      },
      { jobId },
    );
    expect(JSON.stringify(queueAdd.mock.calls[0])).not.toContain('"t"');

    const queued = await (await api(token, `/${jobId}`)).json();
    expect(queued).toMatchObject({ status: 'queued', file: null });

    await runLast();

    const done = await (await api(token, `/${jobId}`)).json();
    expect(done).toMatchObject({
      status: 'done',
      data: { rows: 1, echo: { period: 'month' }, payments: false },
      error: null,
      file: { filename: 'отчёт-тест.xlsx' },
    });

    const file = await api(token, `/${jobId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(XLSX_TYPE);
    expect(file.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('отчёт-тест.xlsx')}`,
    );
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
  });

  it('повторный POST того же kind во время работы — тот же jobId, в очередь второй раз не ставится', async () => {
    const token = await tokenOf('vasya');
    const first = (await (await api(token, '', { kind: 'test-xlsx' })).json()) as { jobId: string };
    const second = (await (await api(token, '', { kind: 'test-xlsx' })).json()) as {
      jobId: string;
      created: boolean;
    };
    expect(second).toEqual({ jobId: first.jobId, created: false });
    expect(queueAdd).toHaveBeenCalledTimes(1);

    // Завершилась — замок снят, следующий POST ставит новую задачу.
    await runLast();
    const third = (await (await api(token, '', { kind: 'test-xlsx' })).json()) as { jobId: string };
    expect(third.jobId).not.toBe(first.jobId);
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('без магазина → 400, чужой ключ → 404 STORE_NOT_FOUND; в очередь ничего', async () => {
    const petya = await tokenOf('petya');
    expect((await api(petya, '', { kind: 'test-xlsx', store: undefined })).status).toBe(400);
    // FBY_KEY — магазин Васи: у Пети его в кэше нет.
    const foreign = await api(petya, '', { kind: 'test-xlsx', store: FBY_KEY });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: 'STORE_NOT_FOUND' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('отчёт считается по открытому магазину, активный магазин бота не меняется', async () => {
    const seen: { campaign: string; business: string; placement: unknown }[] = [];
    registry.register('whoami', {
      features: [],
      run: async ({ store }) => {
        seen.push({
          campaign: store.campaign_id,
          business: store.business_id,
          placement: store.stores?.find((s) => s.campaignId === store.campaign_id)?.placementType,
        });
        return { data: null };
      },
    });
    const token = await tokenOf('vasya');
    await api(token, '', { kind: 'whoami', store: FBY_KEY });
    await runLast();

    expect(seen).toEqual([{ campaign: '87654321', business: '2', placement: 'FBY' }]);
    const doc = await app.get(YandexMarketService).findByTelegramUser('222');
    expect(doc?.campaign_id).toBe('12345678');
  });

  it('замок — на магазин: тот же kind в двух магазинах идёт двумя задачами', async () => {
    const token = await tokenOf('vasya');
    const fbs = (await (await api(token, '', { kind: 'test-xlsx' })).json()) as { jobId: string };
    const fby = (await (await api(token, '', { kind: 'test-xlsx', store: FBY_KEY })).json()) as {
      jobId: string;
      created: boolean;
    };
    expect(fby.created).toBe(true);
    expect(fby.jobId).not.toBe(fbs.jobId);
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('FBY-only фича решается по модели ОТКРЫТОГО магазина, не активного', async () => {
    registry.register('fby-screen', {
      features: [FEATURE.FBY],
      run: async () => ({ data: null }),
    });
    const token = await tokenOf('vasya');
    // Сама фича default-off — открываем Васе, чтобы проверять именно модель.
    await app.get(UserAccessService).setFeature('222', '999', FEATURE.FBY, true);

    const onFbs = await api(token, '', { kind: 'fby-screen' });
    expect(onFbs.status).toBe(403);
    expect(await onFbs.json()).toMatchObject({ code: 'FBY_ONLY' });

    // Активный в боте — тот же FBS, но открыт FBY-магазин: пропускаем.
    expect((await api(token, '', { kind: 'fby-screen', store: FBY_KEY })).status).toBe(202);
  });

  it('магазин пропал из кэша к моменту обработки → failed с понятным текстом', async () => {
    const token = await tokenOf('vasya');
    const { jobId } = (await (
      await api(token, '', { kind: 'test-xlsx', store: FBY_KEY })
    ).json()) as { jobId: string };
    await app.get(YandexMarketService).updateByTelegramUser('222', {
      stores: [{ campaignId: '12345678', businessId: '1', businessName: '', storeName: '' }],
    });
    await runLast();

    const view = (await (await api(token, `/${jobId}`)).json()) as {
      status: string;
      error: string;
    };
    expect(view.status).toBe('failed');
    expect(view.error).toContain('«Магазины»');
    expect(report).not.toHaveBeenCalled();
  });

  it('чужой jobId → 404 и на статус, и на файл', async () => {
    const vasya = await tokenOf('vasya');
    const petya = await tokenOf('petya');
    const { jobId } = (await (await api(vasya, '', { kind: 'test-xlsx' })).json()) as {
      jobId: string;
    };
    await runLast();

    expect((await api(petya, `/${jobId}`)).status).toBe(404);
    expect((await api(petya, `/${jobId}/file`)).status).toBe(404);
    expect((await api(vasya, '/no-such-job')).status).toBe(404);
  });

  it('ошибка kind-а → failed с человеческим текстом и ErrorReporter', async () => {
    registry.register('boom', {
      features: [],
      run: async () => {
        throw new Error('ECONNRESET внутри');
      },
    });
    const token = await tokenOf('vasya');
    const { jobId } = (await (await api(token, '', { kind: 'boom' })).json()) as { jobId: string };
    await runLast();

    const view = await (await api(token, `/${jobId}`)).json();
    expect(view).toMatchObject({
      status: 'failed',
      error: 'Не удалось собрать отчёт. Попробуйте позже.',
    });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'crm', context: 'crm-job:boom', telegramUserId: '222' }),
    );
    expect((await api(token, `/${jobId}/file`)).status).toBe(404);
  });

  it('ожидаемый отказ (CrmJobError) — текст как есть, админов не будим', async () => {
    registry.register('empty', {
      features: [],
      run: async () => {
        throw new CrmJobError('За период нет данных');
      },
    });
    const token = await tokenOf('vasya');
    const { jobId } = (await (await api(token, '', { kind: 'empty' })).json()) as { jobId: string };
    await runLast();

    expect(await (await api(token, `/${jobId}`)).json()).toMatchObject({
      status: 'failed',
      error: 'За период нет данных',
    });
    expect(report).not.toHaveBeenCalled();
  });

  it('результат больше лимита → failed с причиной, без падения', async () => {
    registry.register('huge', {
      features: [],
      run: async () => ({
        data: null,
        file: {
          buffer: Buffer.alloc(MAX_RESULT_BYTES + 1),
          filename: 'big.xlsx',
          contentType: XLSX_TYPE,
        },
      }),
    });
    const token = await tokenOf('vasya');
    const { jobId } = (await (await api(token, '', { kind: 'huge' })).json()) as { jobId: string };
    await runLast();

    const view = (await (await api(token, `/${jobId}`)).json()) as {
      status: string;
      error: string;
    };
    expect(view.status).toBe('failed');
    expect(view.error).toMatch(/слишком большой \(15\.0 МБ\)/);
    // Буфер не лёг в документ.
    expect(results.documents[0].file).toBeNull();
  });

  it('закрытая фича kind-а → 403 FEATURE_DISABLED, в очередь ничего', async () => {
    registry.register('payments', {
      features: [FEATURE.PAYMENTS_REPORT],
      run: async () => ({ data: null }),
    });
    const token = await tokenOf('vasya');
    const response = await api(token, '', { kind: 'payments' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(results.documents).toHaveLength(0);
  });

  it('неизвестный kind и params не-объект → 400', async () => {
    const token = await tokenOf('vasya');
    expect((await api(token, '', { kind: 'nope' })).status).toBe(400);
    expect((await api(token, '', { kind: 'test-xlsx', params: [1] })).status).toBe(400);
  });

  it('сбой постановки в очередь снимает замок', async () => {
    queueAdd.mockRejectedValueOnce(new Error('Redis down'));
    const token = await tokenOf('vasya');
    expect((await api(token, '', { kind: 'test-xlsx' })).status).toBe(500);
    expect(results.documents[0]).toMatchObject({ status: 'failed' });
    expect(results.documents[0].activeKey).toBeUndefined();
  });

  it('упавшая по stalled задача переводится в failed хуком очереди', async () => {
    const token = await tokenOf('vasya');
    const { jobId } = (await (await api(token, '', { kind: 'test-xlsx' })).json()) as {
      jobId: string;
    };
    const [, data] = queueAdd.mock.calls[0] as [string, ICrmJobPayload];
    await processor.onFailed({ data } as never, new Error('job stalled more than allowable limit'));

    expect(await (await api(token, `/${jobId}`)).json()).toMatchObject({
      status: 'failed',
      error: 'Задача прервалась. Попробуйте ещё раз.',
    });
  });
});

describe('contentDisposition', () => {
  it('ASCII-запасное имя без кавычек и полное UTF-8', () => {
    expect(contentDisposition('отчёт "1".xlsx')).toBe(
      `attachment; filename="_____ _1_.xlsx"; filename*=UTF-8''${encodeURIComponent('отчёт "1".xlsx')}`,
    );
  });
});

describe('параллельность crm-jobs', () => {
  const source = readFileSync(
    join(__dirname, '../../src/modules/crm/jobs/crm-jobs.processor.ts'),
    'utf8',
  );

  it('задачи CRM идут параллельно: плитки главной не ждут «Прибыль»', () => {
    expect(CRM_JOBS_CONCURRENCY).toBeGreaterThan(1);
    expect(source).toContain(
      '@Process({ name: JOB_TYPES.RUN_CRM_JOB, concurrency: CRM_JOBS_CONCURRENCY })',
    );
  });

  it('обработчик один: Bull суммирует concurrency всех @Process очереди', () => {
    expect(source.match(/@Process\(/g)).toHaveLength(1);
  });
});
