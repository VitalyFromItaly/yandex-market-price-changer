import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useSalesAnalyticsStore } from './store.sales-analytics';

import { resettableStoresPlugin } from '@/shared/store';

const jobs = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: jobs.start, get: vi.fn(), file: vi.fn() },
}));

vi.mock('@/shared/utils', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  moscowToday: () => '2026-10-15',
}));

beforeEach(() => {
  jobs.start.mockReset();
  jobs.start.mockResolvedValue({ jobId: 'j', created: true });
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Аналитики продаж»', () => {
  it('задача аккаунта без магазина: этот месяц и прошлый той же длины', () => {
    const store = useSalesAnalyticsStore();
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'sales-analytics:summary',
      { from: '2026-10-01', to: '2026-10-15', prevFrom: '2026-09-01', prevTo: '2026-09-15' },
      '',
    );
  });

  it('свои даты — прошлый период той же длины перед ними', () => {
    const store = useSalesAnalyticsStore();
    store.chooseCustom({ from: '2026-10-08', to: '2026-10-14' });
    store.load();
    expect(jobs.start.mock.calls[0]?.[1]).toEqual({
      from: '2026-10-08',
      to: '2026-10-14',
      prevFrom: '2026-10-01',
      prevTo: '2026-10-07',
    });
  });

  it('reset сбрасывает разрез, шаг, метрику, поиск и период', () => {
    const store = useSalesAnalyticsStore();
    store.setSlice('sku');
    store.setGrain('week');
    store.setMetric('units');
    store.setQuery('casio');
    store.choosePreset('7d');
    store.reset();
    expect(store.slice).toBe('time');
    expect(store.grain).toBe('day');
    expect(store.metric).toBe('revenue');
    expect(store.query).toBe('');
    expect(store.preset).toBe('month');
  });
});
