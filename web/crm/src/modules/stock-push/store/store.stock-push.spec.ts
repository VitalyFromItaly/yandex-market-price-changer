import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useStockPushStore } from './store.stock-push';

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

describe('стор «Передачи остатков»', () => {
  it('план — задача аккаунта; повторный вход не ставит вторую', () => {
    const store = useStockPushStore();
    store.ensure();
    store.ensure();
    expect(jobs.start).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledWith('stock-push:plan', {}, '');
  });

  it('без плана записывать нечего — запрос не уходит', async () => {
    const store = useStockPushStore();
    await store.apply();
    expect(store.isWriting).toBe(false);
    expect(store.applyError).toBeNull();
  });
});
