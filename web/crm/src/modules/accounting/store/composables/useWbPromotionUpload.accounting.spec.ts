import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useAccountingStore } from '../store.accounting';

import { ApiError } from '@/shared/http';
import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ uploadWbPromotion: vi.fn() }));
vi.mock('../../api/accountingApi.accounting', () => ({ accountingApi: api }));

const file = (name = 'promo.xlsx', size = 10) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => {
  api.uploadWbPromotion.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('загрузка «Продвижения» WB в сторе «Финучёта»', () => {
  it('успех — итог словами; reset очищает', async () => {
    api.uploadWbPromotion.mockResolvedValue({
      status: 'imported',
      month: '2026-09',
      rows: 2,
      inserted: 2,
      matched: 0,
    });
    const store = useAccountingStore();
    await store.uploadWbPromotion(file(), '2026-09');
    expect(api.uploadWbPromotion).toHaveBeenCalledWith(expect.any(File), '2026-09');
    expect(store.wbPromotionSummary?.title).toBe('Реклама WB за сентябрь 2026 загружена');
    expect(store.wbPromotionUploading).toBe(false);
    resetAllStores();
    expect(store.wbPromotionSummary).toBeNull();
  });

  it('чужое расширение — отказ до запроса, под полем файла', async () => {
    const store = useAccountingStore();
    await store.uploadWbPromotion(file('promo.pdf'), '2026-09');
    expect(api.uploadWbPromotion).not.toHaveBeenCalled();
    expect(store.wbPromotionErrors.file).toContain('promo.pdf');
  });

  it('нераспознанный файл — текст сервера и колонки; выбор другого файла снимает ошибку', async () => {
    api.uploadWbPromotion.mockRejectedValue(
      new ApiError('Не похоже на отчёт', 400, 'FINANCE_FILE_UNRECOGNIZED', 'file', {
        missing: ['ID кампании'],
      }),
    );
    const store = useAccountingStore();
    await store.uploadWbPromotion(file(), '2026-09');
    expect(store.wbPromotionErrors).toEqual({
      file: 'Не похоже на отчёт',
      form: null,
      missing: ['ID кампании'],
    });
    store.clearWbPromotionFileError();
    expect(store.wbPromotionErrors.file).toBeNull();
  });

  it('WB не подключён — над формой', async () => {
    api.uploadWbPromotion.mockRejectedValue(new ApiError('WB не подключён', 409, 'NOT_CONNECTED'));
    const store = useAccountingStore();
    await store.uploadWbPromotion(file(), '2026-09');
    expect(store.wbPromotionErrors.form).toBe('WB не подключён');
  });
});
