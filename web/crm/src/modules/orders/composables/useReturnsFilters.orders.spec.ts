import type { OrderRow } from '../orders.domain';

import { describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

import { useReturnsFilters } from './useReturnsFilters.orders';

const route = reactive<{ query: Record<string, string> }>({ query: {} });
const replace = vi.fn((to: { query: Record<string, string> }) => {
  route.query = to.query;
});
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }));

const row = (n: number, tab: string, statusLabel: string, type: OrderRow['type']): OrderRow => ({
  id: String(n),
  orderId: n,
  type,
  typeLabel: '',
  date: '',
  dateSort: 0,
  statusLabel,
  items: '',
  sales: 100,
  subsidies: 0,
  withDelivery: 100,
  tab,
});

const TABS = [
  { key: 'readyForPickup', label: 'Готовы к выдаче' },
  { key: 'inTransit', label: 'В пути' },
];
const ROWS = [
  row(1, 'inTransit', 'Едет к вам', 'return'),
  row(2, 'inTransit', 'Не выкуплен', 'nonRedemption'),
  row(3, 'readyForPickup', 'Ждёт в пункте', 'return'),
];

describe('useReturnsFilters', () => {
  it('вкладка — в URL (?rt=), счётчики — под статусом и типом, «Все» последней', async () => {
    route.query = {};
    const filters = useReturnsFilters(ref(ROWS), ref(TABS));
    expect(filters.options.value.map((tab) => [tab.label, tab.count])).toEqual([
      ['Готовы к выдаче', 1],
      ['В пути', 2],
      ['Все', 3],
    ]);

    filters.tab.value = 'inTransit';
    await nextTick();
    expect(route.query.rt).toBe('inTransit');
    expect(filters.filtered.value.map((r) => r.orderId)).toEqual([1, 2]);

    filters.type.value = 'return';
    expect(filters.filtered.value.map((r) => r.orderId)).toEqual([1]);
    expect(filters.options.value.map((tab) => tab.count)).toEqual([1, 1, 2]);

    filters.clear();
    await nextTick();
    expect(route.query.rt).toBeUndefined();
    expect(filters.filtered.value).toHaveLength(3);
  });

  it('чужая вкладка в URL — «Все»; статус, которого нет в новом отчёте, снимается', async () => {
    route.query = { rt: 'nope' };
    const rows = ref(ROWS);
    const filters = useReturnsFilters(rows, ref(TABS));
    expect(filters.tab.value).toBeNull();

    filters.status.value = 'Ждёт в пункте';
    expect(filters.filtered.value.map((r) => r.orderId)).toEqual([3]);
    rows.value = ROWS.slice(0, 2);
    await nextTick();
    expect(filters.status.value).toBeNull();
    expect(filters.statuses.value).toEqual(['Едет к вам', 'Не выкуплен']);
  });
});
