import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useInventoryStore } from './store.inventory';

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

describe('стор «Склада»', () => {
  it('задача аккаунта без магазина, с площадкой экрана; повторный вход не ставит вторую', () => {
    const store = useInventoryStore();
    store.ensure('ym');
    store.ensure('ym');
    expect(jobs.start).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledWith('inventory:summary', { marketplace: 'ym' }, '');
  });

  it('другая площадка (TASK-182) — своя задача; «Обновить» — по площадке экрана', () => {
    const store = useInventoryStore();
    store.ensure('ym');
    store.ensure('ozon');
    expect(jobs.start).toHaveBeenLastCalledWith('inventory:summary', { marketplace: 'ozon' }, '');
    store.refresh();
    expect(jobs.start).toHaveBeenCalledTimes(3);
    expect(jobs.start).toHaveBeenLastCalledWith('inventory:summary', { marketplace: 'ozon' }, '');
  });

  it('«Обновить» ставит задачу заново; reset — снова как при первом входе', () => {
    const store = useInventoryStore();
    store.ensure('ym');
    store.refresh();
    expect(jobs.start).toHaveBeenCalledTimes(2);
    store.reset();
    store.ensure('ym');
    expect(jobs.start).toHaveBeenCalledTimes(3);
  });
});
