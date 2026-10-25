import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useReturnsAnalyticsStore } from './store.returns-analytics';

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

describe('стор «Аналитики возвратов»', () => {
  it('задача аккаунта без магазина за текущий месяц', () => {
    const store = useReturnsAnalyticsStore();
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'returns-analytics:summary',
      { from: '2026-10-01', to: '2026-10-15', marketplace: 'ym' },
      '',
    );
  });

  it('площадка экрана (TASK-182) — в params задачи', () => {
    const store = useReturnsAnalyticsStore();
    store.selectMarketplace('ozon');
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'returns-analytics:summary',
      { from: '2026-10-01', to: '2026-10-15', marketplace: 'ozon' },
      '',
    );
  });

  it('reset возвращает вид по умолчанию', () => {
    const store = useReturnsAnalyticsStore();
    store.setSlice('sku');
    store.selectMarketplace('wb');
    store.setQuery('casio');
    store.reset();
    expect([store.slice, store.marketplace, store.query]).toEqual(['brand', 'ym', '']);
  });
});
