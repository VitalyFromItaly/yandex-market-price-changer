import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useTopSkusStore } from './store.top-skus';

import { resettableStoresPlugin } from '@/shared/store';

const jobs = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: jobs.start, get: vi.fn(), file: vi.fn() },
}));

vi.mock('@/shared/utils', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  moscowToday: () => '2026-11-17',
}));

beforeEach(() => {
  jobs.start.mockReset();
  jobs.start.mockResolvedValue({ jobId: 'j', created: true });
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Топа товаров»', () => {
  it('задача магазина: период «этот месяц» уходит диапазоном бота в ДД-ММ-ГГГГ', () => {
    const store = useTopSkusStore();
    store.load('shop-1');
    expect(jobs.start).toHaveBeenCalledWith(
      'top-skus:summary',
      { period: { key: 'range', from: '01-11-2026', to: '17-11-2026' } },
      'shop-1',
    );
  });

  it('свои даты — тем же диапазоном', () => {
    const store = useTopSkusStore();
    store.chooseCustom({ from: '2026-09-01', to: '2026-10-31' });
    store.load('shop-1');
    expect(jobs.start.mock.calls[0]?.[1]).toEqual({
      period: { key: 'range', from: '01-09-2026', to: '31-10-2026' },
    });
  });

  it('reset сбрасывает период, поиск и сортировку', () => {
    const store = useTopSkusStore();
    store.choosePreset('7d');
    store.setQuery('casio');
    store.setSort('count');
    store.reset();
    expect(store.preset).toBe('month');
    expect(store.query).toBe('');
    expect(store.sort).toBe('revenue');
  });
});
