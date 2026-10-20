import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useMarketplaceCompareStore } from './store.marketplace-compare';

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

describe('стор «Сравнения площадок»', () => {
  it('по умолчанию прошлый месяц против позапрошлого — задача аккаунта без магазина', () => {
    const store = useMarketplaceCompareStore();
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'marketplace-compare:summary',
      { from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-01', prevTo: '2026-08-31' },
      '',
    );
  });

  it('свой период задом наперёд — задача не ставится', () => {
    const store = useMarketplaceCompareStore();
    store.chooseCustom({ from: '2026-10-10', to: '2026-10-01' });
    store.load();
    expect(store.request).toBeNull();
    expect(jobs.start).not.toHaveBeenCalled();
  });

  it('reset возвращает прошлый месяц', () => {
    const store = useMarketplaceCompareStore();
    store.choosePreset('7d');
    store.reset();
    expect(store.preset).toBe('prevmonth');
  });
});
