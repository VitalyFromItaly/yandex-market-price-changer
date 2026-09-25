import type { StockSyncData } from '../price-list.domain';

import { describe, expect, it } from 'vitest';

import {
  localFileError,
  mapPurchasePrices,
  mapStockSync,
  mapUploadError,
} from './mapPriceList.price-list';

import { ApiError } from '@/shared/http';

const data: StockSyncData = {
  headline: '🏬 Остатки не записаны — магазин на модели FBY',
  explanation: 'Товаром на складе Маркета распоряжается сам Маркет.',
  advice: 'Переключитесь на магазин FBS в боте.',
  dryRun: false,
  writeSkipReason: 'placement',
  placementType: 'FBY',
  totalRows: 10,
  catalogSize: 5,
  matched: 4,
  zeroed: 1,
  updated: null,
  purchasePricesSaved: 10,
  purchasePricesSkipped: false,
  matchedBy: {},
  skipped: [{ name: 'X', category: 'C', rowNumber: 3, reason: 'нет в каталоге' }],
  errors: [],
};

describe('mapStockSync', () => {
  it('запрет записи: «Записано» не печатается, успехом не считается', () => {
    const result = mapStockSync(data);
    expect(result.success).toBe(false);
    expect(result.counts.map((c) => c.label)).not.toContain('Записано');
    expect(result.counts.find((c) => c.label.startsWith('Нет в наличии'))?.tone).toBe('warn');
    expect(result.counts.find((c) => c.label === 'Пропущено')?.value).toBe(1);
  });

  it('запись прошла — «Записано» есть; ошибки партий — отдельной строкой', () => {
    const result = mapStockSync({
      ...data,
      writeSkipReason: null,
      updated: 3,
      errors: [{ batch: 2, skus: ['a', 'b'], message: 'bad' }],
    });
    expect(result.counts.find((c) => c.label === 'Записано')?.value).toBe(3);
    expect(result.counts.find((c) => c.tone === 'danger')?.value).toBe(2);
    expect(result.errors).toEqual([{ batch: 2, count: 2, message: 'bad' }]);
    expect(result.success).toBe(false);
  });
});

describe('mapPurchasePrices', () => {
  it('страниц хотя бы одна, дата — по Москве', () => {
    const page = mapPurchasePrices({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
      lastUpdatedAt: '2026-09-23T22:30:00.000Z',
    });
    expect(page.pages).toBe(1);
    expect(page.lastUpdated).toBe('24-09-2026');
    expect(mapPurchasePrices({ ...page, items: [], total: 101, lastUpdatedAt: null }).pages).toBe(
      3,
    );
  });
});

describe('mapUploadError', () => {
  it('размер и расширение — под полем файла', () => {
    expect(mapUploadError(new ApiError('big', 413, 'FILE_TOO_LARGE', 'file')).file).toBe('big');
    expect(mapUploadError(new ApiError('csv', 400, 'INVALID_FILE', 'file')).file).toBe('csv');
  });

  it('уже идёт загрузка — jobId для подхвата опроса', () => {
    const error = new ApiError('busy', 409, 'UPLOAD_RUNNING', null, { jobId: 'j1' });
    expect(mapUploadError(error)).toEqual({ file: null, form: 'busy', runningJobId: 'j1' });
  });

  it('прочее — общая ошибка формы', () => {
    expect(mapUploadError(new Error('x')).form).toContain('Не удалось');
  });
});

describe('localFileError', () => {
  it('расширение без учёта регистра и лимит 10 МБ', () => {
    expect(localFileError({ name: 'Прайс.XLSX', size: 1 })).toBeNull();
    expect(localFileError({ name: 'a.csv', size: 1 })).toContain('a.csv');
    expect(localFileError({ name: 'a.xls', size: 10 * 1024 * 1024 + 1 })).toContain('10 МБ');
  });
});
