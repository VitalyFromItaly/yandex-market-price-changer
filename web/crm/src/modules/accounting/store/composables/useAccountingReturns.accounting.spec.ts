import type * as Composables from '@/shared/composables';

import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import { returnsResponse } from '../../mappers/accountingReturns.fixtures.accounting';

import { isOwnReturns, useAccountingReturns } from './useAccountingReturns.accounting';

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

describe('useAccountingReturns', () => {
  it('фоновая задача accounting:returns с магазином и месяцем', () => {
    const job = useAccountingReturns();
    const spec = specs.at(-1) as { launch: Launch };
    expect(spec.launch({ store: 's1', month: '2026-10' })).toEqual({
      kind: 'accounting:returns',
      params: { month: '2026-10' },
      store: 's1',
    });
    expect(job.returns.value).toBeNull();
  });

  it('своё — только при совпавшем месяце', () => {
    const data = returnsResponse();
    expect(isOwnReturns(data, { store: 's1', month: '2026-10' })).toBe(true);
    expect(isOwnReturns(data, { store: 's1', month: '2026-09' })).toBe(false);
  });
});
