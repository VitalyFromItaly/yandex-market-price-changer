import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useOverviewStore } from './store.overview';

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

describe('стор «Обзора»', () => {
  it('этот месяц и прошлый месяц с 1-го по то же число — задачи аккаунта без магазина', () => {
    const store = useOverviewStore();
    store.load(true);
    const period = {
      from: '2026-10-01',
      to: '2026-10-15',
      prevFrom: '2026-09-01',
      prevTo: '2026-09-15',
    };
    expect(jobs.start).toHaveBeenCalledWith('overview:summary', period, '');
    expect(jobs.start).toHaveBeenCalledWith('overview:cancelled', period, '');
    expect(jobs.start).toHaveBeenCalledWith('overview:stocks', {}, '');
  });

  it('без «Финансов» сводка денег не ставится — её отбил бы гейт', () => {
    const store = useOverviewStore();
    store.load(false);
    const kinds = jobs.start.mock.calls.map(([kind]) => kind);
    expect(kinds).not.toContain('overview:summary');
    expect(kinds).toContain('overview:stocks');
  });

  it('смена периода перезапускает только зависящее от него', () => {
    const store = useOverviewStore();
    store.choosePreset('prevmonth');
    store.loadPeriod(true);
    const kinds = jobs.start.mock.calls.map(([kind]) => kind);
    expect(kinds).toEqual(['overview:summary', 'overview:cancelled']);
    expect(jobs.start.mock.calls[0]?.[1]).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      prevFrom: '2026-08-01',
      prevTo: '2026-08-31',
    });
  });

  it('свой период: пустой — задача не ставится; задом наперёд — тоже', () => {
    const store = useOverviewStore();
    store.chooseCustom({ from: '2026-10-10', to: '2026-10-01' });
    expect(store.request).toBeNull();
    store.chooseCustom({ from: '2026-01-01', to: '2026-03-31' });
    expect(store.request?.previous).toEqual({ from: '2025-10-03', to: '2025-12-31' });
  });
});
