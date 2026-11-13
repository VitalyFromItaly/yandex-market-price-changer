import type * as Composables from '@/shared/composables';

import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import { ordersResponse, cardResponse } from '../../mappers/accountingOrders.fixtures.accounting';

import { isOwnOrder, useAccountingOrder } from './useAccountingOrder.accounting';
import { isOwnOrders, useAccountingOrders } from './useAccountingOrders.accounting';

const specs = vi.hoisted(() => [] as unknown[]);
vi.mock('@/shared/composables', async (original) => ({
  ...(await original<typeof Composables>()),
  useReportJob: (spec: unknown) => {
    specs.push(spec);
    return {
      request: ref(null),
      data: computed(() => null),
      isLoading: computed(() => false),
      isRefreshing: computed(() => false),
      savedAt: computed(() => null),
      isFresh: computed(() => false),
      error: ref(null),
      run: vi.fn(),
      retry: vi.fn(),
      download: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

type Launch = (r: unknown) => { kind: string; params: Record<string, unknown>; store: string };
const REQUEST = { store: 's1', month: '2026-10', marketplace: null, state: null, lossOnly: false };

describe('useAccountingOrders', () => {
  it('фоновая задача accounting:orders с магазином; пустые фильтры не уходят', () => {
    useAccountingOrders();
    const spec = specs.at(-1) as { launch: Launch };
    expect(spec.launch(REQUEST)).toEqual({
      kind: 'accounting:orders',
      params: { month: '2026-10', lossOnly: false },
      store: 's1',
    });
    expect(
      spec.launch({ ...REQUEST, marketplace: 'ozon', state: 'forecast', lossOnly: true }),
    ).toEqual({
      kind: 'accounting:orders',
      params: { month: '2026-10', marketplace: 'ozon', state: 'forecast', lossOnly: true },
      store: 's1',
    });
  });

  it('своё — только при совпавших месяце и эхе фильтра', () => {
    const data = ordersResponse();
    expect(isOwnOrders(data, REQUEST)).toBe(true);
    expect(isOwnOrders(data, { ...REQUEST, month: '2026-09' })).toBe(false);
    expect(isOwnOrders(data, { ...REQUEST, state: 'forecast' })).toBe(false);
    expect(isOwnOrders(data, { ...REQUEST, lossOnly: true })).toBe(false);
    expect(isOwnOrders(data, { ...REQUEST, marketplace: 'ym' })).toBe(false);
  });
});

describe('useAccountingOrder', () => {
  it('фоновая задача accounting:order; своё — по площадке и номеру', () => {
    useAccountingOrder();
    const spec = specs.at(-1) as { launch: Launch };
    const request = { store: 's1', marketplace: 'ym' as const, orderId: '101' };
    expect(spec.launch(request)).toEqual({
      kind: 'accounting:order',
      params: { marketplace: 'ym', orderId: '101' },
      store: 's1',
    });
    expect(isOwnOrder(cardResponse(), request)).toBe(true);
    expect(isOwnOrder(cardResponse(), { ...request, orderId: '102' })).toBe(false);
    expect(isOwnOrder(cardResponse(), { ...request, marketplace: 'ozon' })).toBe(false);
  });
});
