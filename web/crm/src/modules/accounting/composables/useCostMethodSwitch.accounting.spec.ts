import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { costSettingsResponse } from '../mappers/accountingLots.fixtures.accounting';
import { useAccountingStore } from '../store/store.accounting';

import { COST_METHOD_SWITCH_WARNING, useCostMethodSwitch } from './useCostMethodSwitch.accounting';

import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ costSettings: vi.fn(), saveCostSettings: vi.fn() }));
vi.mock('../api/accountingApi.accounting', () => ({ accountingApi: api }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(async () => {
  api.costSettings.mockReset().mockResolvedValue(costSettingsResponse());
  api.saveCostSettings.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
  await useAccountingStore().loadCostSettings();
});

describe('useCostMethodSwitch', () => {
  it('предупреждение говорит, что меняется только новый учёт', () => {
    expect(COST_METHOD_SWITCH_WARNING).toMatch(/^Меняется только новый учёт/);
  });

  it('выбор не пишет сразу — сначала подтверждение', async () => {
    const switcher = useCostMethodSwitch();
    expect(switcher.current.value).toBe('historical_price');
    expect(switcher.options.value.map((o) => o.value)).toEqual(['historical_price', 'lot_fifo']);
    switcher.choose('lot_fifo');
    expect(switcher.open.value).toBe(true);
    expect(switcher.confirmTitle.value).toBe('Перейти на «Партии закупок (FIFO)»?');
    expect(api.saveCostSettings).not.toHaveBeenCalled();

    api.saveCostSettings.mockResolvedValue(costSettingsResponse({ method: 'lot_fifo' }));
    await switcher.confirm();
    expect(api.saveCostSettings).toHaveBeenCalledWith('lot_fifo');
    expect(switcher.current.value).toBe('lot_fifo');
    expect(switcher.open.value).toBe(false);
  });

  it('тот же режим — без диалога; отмена — без записи', () => {
    const switcher = useCostMethodSwitch();
    switcher.choose('historical_price');
    expect(switcher.open.value).toBe(false);
    switcher.choose('lot_fifo');
    switcher.open.value = false;
    expect(switcher.open.value).toBe(false);
    expect(api.saveCostSettings).not.toHaveBeenCalled();
  });

  it('ошибка записи — под переключателем, режим прежний', async () => {
    api.saveCostSettings.mockRejectedValue(new Error('Нет доступа'));
    const switcher = useCostMethodSwitch();
    switcher.choose('lot_fifo');
    await switcher.confirm();
    expect(switcher.error.value).toBe('Нет доступа');
    expect(switcher.current.value).toBe('historical_price');
    expect(switcher.open.value).toBe(false);
  });
});
