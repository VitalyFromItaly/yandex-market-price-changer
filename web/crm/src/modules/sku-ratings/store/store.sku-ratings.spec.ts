import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useSkuRatingsStore } from './store.sku-ratings';

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

describe('стор «Рейтингов»', () => {
  it('задача аккаунта без магазина: 30 дней и прошлые 30 перед ними', () => {
    const store = useSkuRatingsStore();
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'sku-ratings:summary',
      { from: '2026-09-16', to: '2026-10-15', prevFrom: '2026-08-17', prevTo: '2026-09-15' },
      '',
    );
  });

  it('reset сбрасывает рейтинг, фильтры, поиск и период', () => {
    const store = useSkuRatingsStore();
    store.setTop('loss');
    store.setAbc('A');
    store.setXyz('Z');
    store.setQuery('casio');
    store.choosePreset('7d');
    store.reset();
    expect(store.top).toBe('revenue');
    expect(store.abc).toBe('all');
    expect(store.xyz).toBe('all');
    expect(store.query).toBe('');
    expect(store.preset).toBe('30d');
  });
});
