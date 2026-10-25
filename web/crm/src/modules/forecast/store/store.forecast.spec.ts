import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useForecastStore } from './store.forecast';

import { resettableStoresPlugin } from '@/shared/store';

const jobs = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: jobs.start, get: vi.fn(), file: vi.fn() },
}));

beforeEach(() => {
  jobs.start.mockReset();
  jobs.start.mockResolvedValue({ jobId: 'j', created: true });
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Прогнозов»', () => {
  it('прогноз — задача аккаунта с окном 28 дней по умолчанию', () => {
    const store = useForecastStore();
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'forecast:summary',
      { basisDays: 28, marketplace: 'ym' },
      '',
    );
  });

  it('площадка экрана (TASK-183) — в params обеих задач; reset возвращает ЯМ', () => {
    const store = useForecastStore();
    store.selectMarketplace('ozon');
    store.load();
    store.loadPurchases();
    expect(jobs.start).toHaveBeenCalledWith(
      'forecast:summary',
      { basisDays: 28, marketplace: 'ozon' },
      '',
    );
    expect(jobs.start).toHaveBeenCalledWith(
      'forecast:purchases',
      { basisDays: 28, coverDays: 30, marketplace: 'ozon' },
      '',
    );
    store.reset();
    expect(store.marketplace).toBe('ym');
  });

  it('закупки — только по кнопке, с окном и днями запаса', () => {
    const store = useForecastStore();
    store.setBasisDays(56);
    store.setCoverDays(45);
    store.loadPurchases();
    expect(jobs.start).toHaveBeenCalledWith(
      'forecast:purchases',
      { basisDays: 56, coverDays: 45, marketplace: 'ym' },
      '',
    );
  });

  it('reset возвращает окно, запас и what-if', () => {
    const store = useForecastStore();
    store.setBasisDays(14);
    store.setCoverDays(60);
    store.setWhatIfPp(5);
    store.reset();
    expect(store.basisDays).toBe(28);
    expect(store.coverDays).toBe(30);
    expect(store.whatIfPp).toBe(0);
  });
});
