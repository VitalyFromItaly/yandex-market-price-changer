import type * as Composables from '@/shared/composables';

import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import {
  analyticsResponse,
  dashboardResponse,
  drillResponse,
} from '../../mappers/accountingDashboard.fixtures.accounting';

import { isOwnAnalytics, useAccountingAnalytics } from './useAccountingAnalytics.accounting';
import { isOwnDashboard, useAccountingDashboard } from './useAccountingDashboard.accounting';
import { isOwnDrill, useAccountingDashboardDrill } from './useAccountingDashboardDrill.accounting';

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

const RANGE = { from: '2026-11-01', to: '2026-11-10' };
const FILTER = { marketplace: null, brand: null, offerId: null, orderId: null };
const REQUEST = { store: 's1', basis: 'sale' as const, range: RANGE, filter: FILTER };

describe('useAccountingDashboard', () => {
  it('задача accounting:dashboard: базис, период диапазоном и фильтр плоско', () => {
    const job = useAccountingDashboard();
    const spec = specs.at(-1) as { launch: Launch };
    expect(spec.launch({ ...REQUEST, filter: { ...FILTER, marketplace: 'ym' } })).toEqual({
      kind: 'accounting:dashboard',
      params: {
        basis: 'sale',
        range: RANGE,
        marketplace: 'ym',
        brand: null,
        offerId: null,
        orderId: null,
      },
      store: 's1',
    });
    expect(job.dashboard.value).toBeNull();
  });

  it('своё — тот же базис, диапазон эха и фильтр', () => {
    const data = dashboardResponse();
    expect(isOwnDashboard(data, REQUEST)).toBe(true);
    expect(isOwnDashboard(data, { ...REQUEST, basis: 'cash' })).toBe(false);
    expect(isOwnDashboard(data, { ...REQUEST, range: { ...RANGE, to: '2026-11-09' } })).toBe(false);
    expect(isOwnDashboard(data, { ...REQUEST, filter: { ...FILTER, brand: 'polza' } })).toBe(false);
  });
});

describe('useAccountingDashboardDrill', () => {
  it('задача accounting:dashboard-drill со строкой и блоком', () => {
    const job = useAccountingDashboardDrill();
    const spec = specs.at(-1) as { launch: Launch };
    expect(spec.launch({ ...REQUEST, line: 'commission', block: 'all' })).toMatchObject({
      kind: 'accounting:dashboard-drill',
      params: { basis: 'sale', range: RANGE, line: 'commission', block: 'all' },
      store: 's1',
    });
    expect(job.drillRequest.value).toBeNull();
  });

  it('своё — та же строка и площадка', () => {
    const data = drillResponse();
    expect(isOwnDrill(data, { ...REQUEST, line: 'commission', block: 'ym' })).toBe(true);
    expect(isOwnDrill(data, { ...REQUEST, line: 'commission', block: 'all' })).toBe(false);
    expect(isOwnDrill(data, { ...REQUEST, line: 'logistics', block: 'ym' })).toBe(false);
  });
});

describe('useAccountingAnalytics', () => {
  it('задача accounting:analytics — только период', () => {
    useAccountingAnalytics();
    const spec = specs.at(-1) as { launch: Launch };
    expect(spec.launch({ store: 's1', range: RANGE })).toEqual({
      kind: 'accounting:analytics',
      params: { range: RANGE },
      store: 's1',
    });
  });

  it('своё — тот же диапазон эха', () => {
    const data = analyticsResponse();
    expect(
      isOwnAnalytics(data, { store: 's1', range: { from: '2026-11-01', to: '2026-11-02' } }),
    ).toBe(true);
    expect(isOwnAnalytics(data, { store: 's1', range: RANGE })).toBe(false);
  });
});
