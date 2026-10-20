import { describe, expect, it } from 'vitest';

import { localFinanceFileError, mapFinanceUploadError, toUploadSummary } from './mapUpload.finance';

import { ApiError } from '@/shared/http';

describe('mapFinanceUploadError', () => {
  it('нераспознанный файл — под полем, с перечнем колонок', () => {
    const error = new ApiError('Не похоже на отчёт', 400, 'FINANCE_FILE_UNRECOGNIZED', 'file', {
      missing: ['Сумма транзакции', 3],
    });
    expect(mapFinanceUploadError(error)).toEqual({
      file: 'Не похоже на отчёт',
      form: null,
      missing: ['Сумма транзакции'],
    });
  });

  it('занятый месяц и прочее — над формой; не ApiError — общий текст', () => {
    expect(mapFinanceUploadError(new ApiError('Загружается', 409, 'FINANCE_IMPORT_BUSY'))).toEqual({
      file: null,
      form: 'Загружается',
      missing: [],
    });
    expect(mapFinanceUploadError(new Error('x')).form).toMatch(/Не удалось загрузить/);
  });
});

describe('localFinanceFileError', () => {
  it('расширение и размер — до отправки', () => {
    expect(localFinanceFileError({ name: 'отчёт.CSV', size: 10 })).toBeNull();
    expect(localFinanceFileError({ name: 'отчёт.pdf', size: 10 })).toMatch(
      /\.xlsx, \.xls или \.csv/,
    );
    expect(localFinanceFileError({ name: 'a.xlsx', size: 15 * 1024 * 1024 + 1 })).toMatch(/15 МБ/);
  });
});

describe('toUploadSummary', () => {
  it('новые и бывшие, пропущенные и без статьи — словами; нулевые строки не печатаются', () => {
    expect(
      toUploadSummary({
        status: 'imported',
        month: '2026-09',
        documentId: 'd',
        rows: 10,
        inserted: 2,
        matched: 8,
        skippedSuperseded: 0,
        unknown: 0,
      }),
    ).toEqual({
      title: 'Отчёт загружен в журнал за сентябрь 2026',
      lines: ['Операций в файле: 10.', 'Новых в журнале: 2, уже были: 8.'],
    });
    const full = toUploadSummary({
      status: 'imported',
      month: '2026-09',
      documentId: 'd',
      rows: 3,
      inserted: 0,
      matched: 1,
      skippedSuperseded: 1,
      unknown: 1,
    });
    expect(full.lines).toHaveLength(4);
  });

  it('тот же файл — «уже загружен»', () => {
    expect(toUploadSummary({ status: 'unchanged', month: '2026-09', rows: 5 }).title).toBe(
      'Этот файл уже загружен в журнал за сентябрь 2026',
    );
  });
});
