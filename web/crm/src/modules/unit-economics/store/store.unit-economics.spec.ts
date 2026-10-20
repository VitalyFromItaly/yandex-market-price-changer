import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useUnitEconomicsStore } from './store.unit-economics';

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

describe('стор «Unit-экономики»', () => {
  it('задача аккаунта без магазина: этот месяц и прошлый той же длины', () => {
    const store = useUnitEconomicsStore();
    store.load();
    expect(jobs.start).toHaveBeenCalledWith(
      'unit-economics:skus',
      { from: '2026-10-01', to: '2026-10-15', prevFrom: '2026-09-01', prevTo: '2026-09-15' },
      '',
    );
  });

  it('пресет прошлого месяца — прошлый к нему месяц целиком', () => {
    const store = useUnitEconomicsStore();
    store.choosePreset('prevmonth');
    store.load();
    expect(jobs.start.mock.calls[0]?.[1]).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      prevFrom: '2026-08-01',
      prevTo: '2026-08-31',
    });
  });

  it('карточка открывается по артикулу и закрывается; reset всё сбрасывает', () => {
    const store = useUnitEconomicsStore();
    store.open('A1');
    store.setQuery('часы');
    store.reset();
    expect(store.opened).toBeNull();
    expect(store.query).toBe('');
    expect(store.preset).toBe('month');
  });
});
