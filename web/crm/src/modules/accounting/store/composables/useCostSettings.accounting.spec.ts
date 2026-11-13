import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { costSettingsResponse } from '../../mappers/accountingLots.fixtures.accounting';
import { useAccountingStore } from '../store.accounting';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ costSettings: vi.fn(), saveCostSettings: vi.fn() }));
vi.mock('../../api/accountingApi.accounting', () => ({ accountingApi: api }));

beforeEach(() => {
  api.costSettings.mockReset();
  api.saveCostSettings.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('режим себестоимости в сторе «Финучёта»', () => {
  it('загрузка без кеша, но без дубля запроса в полёте; reset очищает', async () => {
    api.costSettings.mockResolvedValue(costSettingsResponse());
    const store = useAccountingStore();
    await Promise.all([store.loadCostSettings(), store.loadCostSettings()]);
    expect(api.costSettings).toHaveBeenCalledTimes(1);
    expect(store.costSettings?.method).toBe('historical_price');
    await store.loadCostSettings();
    expect(api.costSettings).toHaveBeenCalledTimes(2);
    resetAllStores();
    expect(store.costSettings).toBeNull();
  });

  it('сохранение заменяет вид ответом сервера', async () => {
    api.saveCostSettings.mockResolvedValue(
      costSettingsResponse({ method: 'lot_fifo', isDefault: false }),
    );
    const store = useAccountingStore();
    await store.saveCostSettings('lot_fifo');
    expect(api.saveCostSettings).toHaveBeenCalledWith('lot_fifo');
    expect(store.costSettings?.method).toBe('lot_fifo');
  });

  it('ошибка сохранения пробрасывается, вид не меняется', async () => {
    api.costSettings.mockResolvedValue(costSettingsResponse());
    api.saveCostSettings.mockRejectedValue(new Error('Нет доступа'));
    const store = useAccountingStore();
    await store.loadCostSettings();
    await expect(store.saveCostSettings('lot_fifo')).rejects.toThrow('Нет доступа');
    expect(store.costSettings?.method).toBe('historical_price');
  });

  it('ошибка загрузки — текстом', async () => {
    api.costSettings.mockRejectedValue(new Error('500'));
    const store = useAccountingStore();
    await store.loadCostSettings();
    expect(store.costSettingsError).toBe('500');
    expect(store.costSettingsLoading).toBe(false);
  });
});
