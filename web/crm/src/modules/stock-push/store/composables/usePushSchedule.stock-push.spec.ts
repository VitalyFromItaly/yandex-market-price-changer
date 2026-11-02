import type { PushSchedule } from '../../stock-push.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useStockPushStore } from '../store.stock-push';

import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({ getSchedule: vi.fn(), saveInterval: vi.fn() }));
vi.mock('../../api/stockPushApi.stock-push', () => ({ stockPushApi: api }));

function schedule(overrides: Partial<PushSchedule> = {}): PushSchedule {
  return {
    interval: '30m',
    intervalLabel: 'каждые 30 минут',
    options: [],
    about: [],
    nextRunLabel: '15:00',
    lastRun: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('usePushSchedule', () => {
  it('загрузка кладёт вид; ошибка — текстом', async () => {
    const store = useStockPushStore();
    api.getSchedule.mockResolvedValueOnce(schedule());
    await store.load();
    expect(store.schedule?.interval).toBe('30m');

    store.reset();
    api.getSchedule.mockRejectedValueOnce(new Error('Недоступно'));
    await store.load();
    expect(store.schedule).toBeNull();
    expect(store.error).toBe('Недоступно');
  });

  it('смена частоты — вид из ответа; та же частота — без запроса; ошибка — прежняя остаётся', async () => {
    const store = useStockPushStore();
    api.getSchedule.mockResolvedValueOnce(schedule());
    await store.load();

    await store.saveInterval('30m');
    expect(api.saveInterval).not.toHaveBeenCalled();

    api.saveInterval.mockResolvedValueOnce(schedule({ interval: 'off', nextRunLabel: null }));
    await store.saveInterval('off');
    expect(api.saveInterval).toHaveBeenCalledWith('off');
    expect(store.schedule?.interval).toBe('off');

    api.saveInterval.mockRejectedValueOnce(new Error('Сеть'));
    await store.saveInterval('3h');
    expect(store.schedule?.interval).toBe('off');
    expect(store.saveError).toBe('Сеть');
  });
});
