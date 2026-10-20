import type * as Composables from '@/shared/composables';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, ref } from 'vue';

import { useTaxesStore } from './store.taxes';

import { resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  setStaff: vi.fn(),
  reductions: vi.fn(),
  createReduction: vi.fn(),
  updateReduction: vi.fn(),
  removeReduction: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('../api/taxesApi.taxes', () => ({ taxesApi: api }));

/** Фоновая задача года — заглушка: спека проверяет, когда и с чем она запускается. */
const job = vi.hoisted(() => ({ run: vi.fn(), spec: null as unknown }));
vi.mock('@/shared/composables', async (original) => ({
  ...(await original<typeof Composables>()),
  useReportJob: (spec: unknown) => {
    job.spec = spec;
    return {
      data: computed(() => null),
      isLoading: computed(() => false),
      isRefreshing: computed(() => false),
      savedAt: computed(() => null),
      error: ref(null),
      run: job.run,
      retry: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

const LIST = { items: [], kinds: [], noteMaxLength: 200 };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  job.run.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Налоги» — вкладка «Год»', () => {
  it('задача года — kind taxes:year без магазина; своё — только при совпадении года', () => {
    const store = useTaxesStore();
    store.loadYear();
    expect(job.run).toHaveBeenCalledWith({ year: store.year });
    const spec = job.spec as {
      launch: (r: { year: number }) => unknown;
      isOwn: (d: { year: number }, r: { year: number }) => boolean;
    };
    expect(spec.launch({ year: 2025 })).toEqual({
      kind: 'taxes:year',
      params: { year: 2025 },
      store: '',
    });
    expect(spec.isOwn({ year: 2025 }, { year: 2026 })).toBe(false);
  });

  it('смена года перезапускает задачу, тот же год — нет', () => {
    const store = useTaxesStore();
    store.selectYear(store.year);
    expect(job.run).not.toHaveBeenCalled();
    store.selectYear(2024);
    expect(job.run).toHaveBeenCalledWith({ year: 2024 });
  });

  it('уменьшение, удаление, сверка и работники пересчитывают год', async () => {
    const store = useTaxesStore();
    api.createReduction.mockResolvedValue(LIST);
    api.removeReduction.mockResolvedValue(LIST);
    api.reconcile.mockResolvedValue({ ok: true });
    api.setStaff.mockResolvedValue({ hasStaff: true });

    await store.saveReduction(null, {
      paidDay: '2026-03-01',
      kind: 'other',
      amount: '5',
      note: null,
    });
    expect(store.reductions).toEqual(LIST);
    await store.removeReduction('id-1');
    await store.reconcile('h1', {
      accountantIncome: null,
      accountantTax: null,
      checked: true,
      note: null,
    });
    expect(api.reconcile).toHaveBeenCalledWith(
      store.year,
      'h1',
      expect.objectContaining({ checked: true }),
    );
    await store.setStaff(true);
    expect(job.run).toHaveBeenCalledTimes(4);
  });

  it('ошибка записи пробрасывается и год не пересчитывается', async () => {
    const store = useTaxesStore();
    api.updateReduction.mockRejectedValueOnce(new Error('400'));
    await expect(
      store.saveReduction('id-1', { paidDay: '2026-03-01', kind: 'other', amount: '', note: null }),
    ).rejects.toThrow('400');
    expect(job.run).not.toHaveBeenCalled();
  });
});
