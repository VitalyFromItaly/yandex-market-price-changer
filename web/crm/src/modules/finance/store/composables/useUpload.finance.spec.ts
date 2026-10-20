import { describe, expect, it, vi } from 'vitest';

import { useUpload } from './useUpload.finance';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../../api/financeApi.finance', () => ({ financeApi: api }));

const fileOf = (name: string, size = 10) => ({ name, size }) as File;

describe('useUpload', () => {
  it('удачная загрузка — итог и перечитанные месяцы', async () => {
    api.upload.mockResolvedValueOnce({ status: 'unchanged', month: '2026-09', rows: 4 });
    const onDone = vi.fn(async () => undefined);
    const upload = useUpload();

    await upload.uploadReport(fileOf('отчёт.xlsx'), '2026-09', onDone);

    expect(api.upload).toHaveBeenCalledWith(expect.anything(), '2026-09');
    expect(upload.uploadSummary.value?.title).toMatch(/уже загружен/);
    expect(onDone).toHaveBeenCalledOnce();
    expect(upload.uploading.value).toBe(false);
  });

  it('не тот файл — отказ до сервера; отказ сервера — под полем с колонками', async () => {
    api.upload.mockClear();
    const upload = useUpload();
    await upload.uploadReport(fileOf('a.pdf'), '2026-09');
    expect(api.upload).not.toHaveBeenCalled();
    expect(upload.uploadErrors.value.file).toMatch(/\.csv/);

    api.upload.mockRejectedValueOnce(
      new ApiError('нет колонок', 400, 'FINANCE_FILE_UNRECOGNIZED', 'file', {
        missing: ['Сумма транзакции'],
      }),
    );
    await upload.uploadReport(fileOf('a.xlsx'), '2026-09');
    expect(upload.uploadErrors.value).toEqual({
      file: 'нет колонок',
      form: null,
      missing: ['Сумма транзакции'],
    });
    upload.clearUploadFileError();
    expect(upload.uploadErrors.value.missing).toEqual([]);
  });
});
