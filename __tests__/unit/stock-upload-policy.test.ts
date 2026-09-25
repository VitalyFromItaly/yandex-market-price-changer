import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { StockSyncProcessor } from '../../src/modules/telegram/queue/processors/stock-sync.processor';
import {
  skipAdvice,
  stockHeadlineText,
  toCrmStockView,
} from '../../src/modules/yandex/stocks/stock-report';
import {
  UPLOAD_LIMITS,
  checkUploadFile,
  decideUpload,
} from '../../src/modules/yandex/stocks/stock-upload-policy';
import { StockUploadPolicyService } from '../../src/modules/yandex/stocks/stock-upload-policy.service';
import { uploadWarningText } from '../../src/modules/yandex/stocks/stock-upload.texts';
import { FBY_STOCKS_READONLY } from '../../src/modules/yandex/stocks/placement';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';

/**
 * Ранний слой барьеров записи остатков — общий для бота и CRM. Последний
 * слой (StockSyncService.sync / writeInBatches) проверяет stocks-sync.test.ts.
 */
describe('decideUpload', () => {
  const base = {
    savePrices: true,
    stockFeatureOn: true,
    writeEnabled: true,
    placementType: 'FBS' as string | undefined,
    dryRun: false,
  };

  it('всё открыто, FBS — пишем остатки и закуп, без предупреждений', () => {
    expect(decideUpload(base)).toMatchObject({
      accepted: true,
      stocksReadOnly: false,
      warning: null,
      progress: 'stocks',
    });
  });

  it('обе фичи выключены — отказ', () => {
    expect(decideUpload({ ...base, savePrices: false, stockFeatureOn: false })).toEqual({
      accepted: false,
    });
  });

  it('env выключена — остатки только читаются, и о модели не предупреждаем', () => {
    // Порядок env → фича → модель: при выключенной среде модель не спрошена
    // (undefined), и это НЕ «модель не определилась».
    const decision = decideUpload({ ...base, writeEnabled: false, placementType: undefined });
    expect(decision).toMatchObject({
      accepted: true,
      stocksReadOnly: true,
      warning: null,
      progress: 'prices-only',
    });
  });

  it('неопределившаяся модель — запрет записи, отдельное предупреждение, не FBY', () => {
    expect(decideUpload({ ...base, placementType: undefined })).toMatchObject({
      accepted: true,
      stocksReadOnly: true,
      warning: 'placement-unknown',
    });
  });

  it('FBY — файл принят ради закупа, предупреждение fby', () => {
    expect(decideUpload({ ...base, placementType: 'FBY' })).toMatchObject({
      accepted: true,
      stocksReadOnly: true,
      savePurchasePrices: true,
      stockWriteAllowed: true,
      warning: 'fby',
      progress: 'prices-only',
    });
  });

  it('FBY и закуп выключен — файлу нечего делать; «проверка» всё же пропускается', () => {
    const fbyNoPrices = { ...base, placementType: 'FBY', savePrices: false };
    expect(decideUpload(fbyNoPrices)).toEqual({ accepted: false });
    expect(decideUpload({ ...fbyNoPrices, dryRun: true })).toMatchObject({
      accepted: true,
      progress: 'check',
    });
  });

  it('фича остатков выключена — её предупреждение важнее модели', () => {
    expect(
      decideUpload({ ...base, stockFeatureOn: false, placementType: undefined }),
    ).toMatchObject({ warning: 'stock-feature-off', stockWriteAllowed: false });
  });
});

describe('StockUploadPolicyService', () => {
  const store = { stores: [{ campaignId: 'c1', placementType: 'FBS' }] };
  const credentials = { token: 't', campaignId: 'c1', businessId: 'b' };
  const request = { savePrices: true, stockFeatureOn: true, dryRun: false };

  it('env выключена — Маркет о модели не спрашивается вовсе', async () => {
    const placementFor = vi.fn();
    const policy = new StockUploadPolicyService(
      { placementFor } as never,
      { stockWriteEnabled: false } as never,
    );

    await policy.decide({}, credentials, request);

    expect(placementFor).not.toHaveBeenCalled();
  });

  it('кэш знает модель — без запроса; не знает — живой placementFor', async () => {
    const placementFor = vi.fn(async () => 'FBY');
    const policy = new StockUploadPolicyService(
      { placementFor } as never,
      { stockWriteEnabled: true } as never,
    );

    expect(await policy.decide(store, credentials, request)).toMatchObject({ warning: null });
    expect(placementFor).not.toHaveBeenCalled();

    expect(await policy.decide({}, credentials, request)).toMatchObject({ warning: 'fby' });
    expect(placementFor).toHaveBeenCalledTimes(1);
  });
});

describe('checkUploadFile', () => {
  it('расширение без учёта регистра, ровно лимит проходит, байт сверху — нет', () => {
    expect(checkUploadFile('Прайс.XLSX', 100)).toBeNull();
    expect(checkUploadFile('a.xls', UPLOAD_LIMITS.maxBytes)).toBeNull();
    expect(checkUploadFile('a.xlsx', UPLOAD_LIMITS.maxBytes + 1)).toBe('size');
    expect(checkUploadFile('a.csv', 1)).toBe('extension');
    expect(checkUploadFile('noext', 1)).toBe('extension');
  });
});

describe('тексты: одна копия, два канала', () => {
  it('бот говорит прежним текстом, CRM — без разметки и со списком «Магазины»', () => {
    expect(uploadWarningText('fby', 'bot')).toBe(FBY_STOCKS_READONLY);
    const crm = uploadWarningText('fby', 'crm');
    expect(crm).not.toContain('<b>');
    // В CRM магазин не переключают, а открывают другой: кнопка бота там — ложный след.
    expect(crm).toContain('«Магазины»');
    expect(crm).not.toContain('Сменить магазин');
  });

  const fbyResult = {
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
    writeSkipReason: 'placement' as const,
  };

  it('совет CRM указывает, где другой магазин и где «проверка»', () => {
    expect(skipAdvice(fbyResult, 'crm')).toContain('«Магазины»');
    expect(skipAdvice(fbyResult, 'bot')).toContain('«🏪 Сменить магазин»');
    expect(skipAdvice({ ...fbyResult, writeSkipReason: undefined, dryRun: true }, 'crm')).toContain(
      'Только проверка',
    );
  });

  it('вид CRM — plain-заголовок и «записано» только когда писали', () => {
    const view = toCrmStockView(fbyResult);
    expect(view.headline).toBe(stockHeadlineText(fbyResult));
    expect(view.headline).not.toContain('<');
    expect(view.updated).toBeNull();
    expect(toCrmStockView({ ...fbyResult, writeSkipReason: undefined, updated: 7 }).updated).toBe(
      7,
    );
  });
});

/**
 * Очередь file-processing обязана исполнять ровно одну джобу за раз: туда
 * ставят прайсы и бот, и CRM. Мёртвый FileProcessingProcessor висел на ней с
 * тремя @Process по concurrency 3, и Bull суммирует конкурентность всех
 * обработчиков очереди — записи остатков шли по 10 параллельно.
 */
describe('очередь file-processing', () => {
  it('мёртвый FileProcessingProcessor не зарегистрирован провайдером', () => {
    const source = readFileSync(
      join(__dirname, '../../src/modules/telegram/telegram.module.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/import\s*\{\s*FileProcessingProcessor\s*\}/);
  });

  it('у SYNC_STOCKS нет повышенной concurrency', () => {
    const source = readFileSync(
      join(__dirname, '../../src/modules/telegram/queue/processors/stock-sync.processor.ts'),
      'utf8',
    );
    expect(source).toContain('@Process(JOB_TYPES.SYNC_STOCKS)');
    expect(source).not.toMatch(/concurrency/);
  });
});

describe('StockSyncProcessor: CRM', () => {
  it('упавшая насмерть CRM-джоба переводится в failed, чтобы замок не висел сутки', () => {
    const finishFailed = vi.fn(async () => undefined);
    const processor = new StockSyncProcessor(
      {} as never,
      {} as never,
      {} as never,
      { report: async () => undefined } as never,
      { finishFailed } as never,
    );

    processor.onFailed(
      { id: 1, name: 'sync-stocks', data: { source: 'crm', jobId: 'j1' } } as never,
      new Error('job stalled more than allowable limit'),
    );

    expect(finishFailed).toHaveBeenCalledWith('j1', expect.stringContaining('❌'));
  });
});

describe('PurchasePriceService.list', () => {
  function modelSpy() {
    const calls: { filter?: Record<string, unknown>; skip?: number; limit?: number } = {};
    const chain = {
      sort: () => chain,
      skip: (n: number) => ((calls.skip = n), chain),
      limit: (n: number) => ((calls.limit = n), chain),
      select: () => chain,
      lean: () => chain,
      exec: async () => [],
    };
    const model = {
      find: (filter: Record<string, unknown>) => ((calls.filter = filter), chain),
      countDocuments: () => ({ exec: async () => 0 }),
    };
    return { model, calls };
  }

  it('поиск экранирован: «.*» — это текст, а не «всё»', async () => {
    const { model, calls } = modelSpy();
    await new PurchasePriceService(model as never).list('222', { q: '.*', page: 1, limit: 10 });

    const [bySku] = (calls.filter?.$or as { sku: RegExp }[]) ?? [];
    expect(bySku.sku.test('A-1')).toBe(false);
    expect(bySku.sku.test('x.*y')).toBe(true);
    expect(calls.filter?.telegramUserId).toBe('222');
  });

  it('страница и потолок лимита', async () => {
    const { model, calls } = modelSpy();
    await new PurchasePriceService(model as never).list('222', { page: 3, limit: 500 });

    expect(calls.limit).toBe(100);
    expect(calls.skip).toBe(200);
    expect(calls.filter?.$or).toBeUndefined();
  });
});
