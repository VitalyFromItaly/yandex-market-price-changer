import type { ExpensesView } from '../expenses.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useExpensesStore } from './store.expenses';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  addCategory: vi.fn(),
  removeCategory: vi.fn(),
  allocation: vi.fn(),
}));
vi.mock('../api/expensesApi.expenses', () => ({ expensesApi: api }));

const VIEW: ExpensesView = {
  categories: [{ key: 'rent', label: 'Аренда', custom: false }],
  expenses: [],
  limits: { noteMaxLength: 200, categoryNameMaxLength: 60 },
};
const allocationOf = (totalKopecks: number) => ({
  from: '2026-10-01',
  to: '2026-10-31',
  totalKopecks,
  byCategory: [],
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Расходы»', () => {
  it('загрузка кладёт вид; ошибка — текстом, без вида', async () => {
    const store = useExpensesStore();
    api.get.mockRejectedValueOnce(new Error('сеть'));
    await store.load();
    expect(store.view).toBeNull();
    expect(store.error).toBe('сеть');

    api.get.mockResolvedValueOnce(VIEW);
    await store.load();
    expect(store.view).toEqual(VIEW);
    expect(store.error).toBeNull();
  });

  it('запись заменяет вид ответом и перечитывает распределение', async () => {
    const store = useExpensesStore();
    const created = { ...VIEW, expenses: [{ id: 'e1' } as ExpensesView['expenses'][number]] };
    api.create.mockResolvedValueOnce(created);
    api.allocation.mockResolvedValueOnce(allocationOf(3_000_000));

    await store.create({
      kind: 'monthly',
      category: 'rent',
      amount: '30000',
      fromDay: '2026-10-01',
      toDay: null,
      note: null,
    });
    expect(store.view).toEqual(created);
    await vi.waitFor(() => expect(store.allocation?.totalKopecks).toBe(3_000_000));
  });

  it('ошибка записи пробрасывается и вид не трогает', async () => {
    const store = useExpensesStore();
    api.get.mockResolvedValueOnce(VIEW);
    await store.load();
    api.remove.mockRejectedValueOnce(new Error('нет'));
    await expect(store.remove('e1')).rejects.toThrow('нет');
    expect(store.view).toEqual(VIEW);
    expect(api.allocation).not.toHaveBeenCalled();
  });

  it('смена пресета: опоздавший ответ прошлого периода не перетирает выбранный', async () => {
    const store = useExpensesStore();
    let releaseMonth: (value: unknown) => void = () => undefined;
    api.allocation
      .mockImplementationOnce(() => new Promise((resolve) => (releaseMonth = resolve)))
      .mockResolvedValueOnce(allocationOf(700_000));

    const first = store.refresh();
    await store.choose('week');
    releaseMonth(allocationOf(3_000_000));
    await first;
    expect(store.preset).toBe('week');
    expect(store.allocation?.totalKopecks).toBe(700_000);
    expect(api.allocation.mock.calls[1]?.[0]).toMatchObject({ from: expect.any(String) });
  });

  it('resetAllStores чистит вид, распределение и пресет', async () => {
    const store = useExpensesStore();
    api.get.mockResolvedValueOnce(VIEW);
    api.allocation.mockResolvedValueOnce(allocationOf(1));
    await store.load();
    await store.choose('prevmonth');
    resetAllStores();
    expect(store.view).toBeNull();
    expect(store.allocation).toBeNull();
    expect(store.preset).toBe('month');
    expect(store.error).toBeNull();
  });
});
