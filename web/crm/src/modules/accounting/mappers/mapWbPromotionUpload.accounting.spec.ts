import { describe, expect, it } from 'vitest';

import { toWbPromotionUploadSummary } from './mapWbPromotionUpload.accounting';

describe('toWbPromotionUploadSummary', () => {
  it('новый файл — сколько новых и сколько уже было', () => {
    expect(
      toWbPromotionUploadSummary({
        status: 'imported',
        month: '2026-09',
        rows: 3,
        inserted: 1,
        matched: 2,
      }),
    ).toEqual({
      title: 'Реклама WB за сентябрь 2026 загружена',
      lines: ['Списаний в файле: 3.', 'Новых: 1, уже были: 2.'],
    });
  });

  it('тот же файл — ничего не изменилось', () => {
    const summary = toWbPromotionUploadSummary({ status: 'unchanged', month: '2026-09', rows: 3 });
    expect(summary.title).toBe('Этот файл уже загружен за сентябрь 2026');
    expect(summary.lines).toEqual(['Списаний в нём: 3. Ничего не изменилось.']);
  });
});
