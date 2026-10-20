import type { OrderDetailResponse, OrderFeedRow } from '../order-feed.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useOrderFeedStore } from './store.order-feed';

import { resettableStoresPlugin } from '@/shared/store';

const jobs = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: jobs.start, get: vi.fn(), file: vi.fn() },
}));

const api = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock('../api/orderFeedApi.order-feed', () => ({ orderFeedApi: api }));

const ROW: OrderFeedRow = {
  marketplace: 'ozon',
  id: '1-2-1',
  orderNumber: '1-2',
  scheme: 'FBS',
  stage: 'redeemed',
  stageLabel: 'Выкуплен',
  status: 'delivered',
  createdDay: '2026-10-01',
  items: [{ sku: 'A1', name: 'Casio', count: 1 }],
  sales: 1500,
  operations: 0,
  operationsKopecks: null,
  cogsKopecks: null,
  profitKopecks: null,
  profitGap: 'no-operations',
  articles: [],
};

const DETAIL: OrderDetailResponse = {
  marketplace: 'ozon',
  orderId: '1-2-1',
  operations: 1,
  operationsKopecks: 120_000,
  cogsKopecks: 100_000,
  profitKopecks: 20_000,
  profitGap: null,
  articles: [{ article: 'sales', title: 'Продажи', group: 'income', kopecks: 120_000 }],
  history: [],
};

beforeEach(() => {
  jobs.start.mockReset();
  jobs.start.mockResolvedValue({ jobId: 'j', created: true });
  api.detail.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Ленты заказов»', () => {
  it('задача аккаунта с периодом недели; повторный вход с тем же периодом не ставит вторую', () => {
    const store = useOrderFeedStore();
    store.ensure();
    store.ensure();
    expect(jobs.start).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledWith('order-feed:list', { period: { key: 'week' } }, '');
  });

  it('смена периода ставит задачу с новым периодом; reset — снова неделя', () => {
    const store = useOrderFeedStore();
    store.ensure();
    store.selectPeriod({ key: 'month', day: null });
    expect(jobs.start).toHaveBeenLastCalledWith(
      'order-feed:list',
      { period: { key: 'month' } },
      '',
    );
    store.reset();
    expect(store.period).toEqual({ key: 'week', day: null });
  });

  it('открытый заказ: строка сразу, история — запросом площадки и номера журнала', async () => {
    api.detail.mockResolvedValue(DETAIL);
    const store = useOrderFeedStore();
    const pending = store.openOrder(ROW);
    expect(store.opened?.id).toBe('1-2-1');
    expect(store.detailLoading).toBe(true);
    await pending;
    expect(api.detail).toHaveBeenCalledWith('ozon', '1-2-1');
    expect(store.detail?.profitKopecks).toBe(20_000);
    store.closeOrder();
    expect(store.opened).toBeNull();
    expect(store.detail).toBeNull();
  });

  it('сбой истории — ошибка внутри диалога, строка остаётся', async () => {
    api.detail.mockRejectedValue(new Error('Нет связи'));
    const store = useOrderFeedStore();
    await store.openOrder(ROW);
    expect(store.detailError).toBe('Нет связи');
    expect(store.opened?.id).toBe('1-2-1');
  });
});
