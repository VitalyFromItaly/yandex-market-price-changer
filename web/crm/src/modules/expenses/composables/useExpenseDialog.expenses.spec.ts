import type { Expense, ExpensesView } from '../expenses.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useExpenseDialog } from './useExpenseDialog.expenses';

import { ApiError } from '@/shared/http';

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
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const VIEW: ExpensesView = {
  categories: [],
  expenses: [],
  limits: { noteMaxLength: 200, categoryNameMaxLength: 60 },
};
const rent: Expense = {
  id: 'e1',
  kind: 'monthly',
  category: 'rent',
  categoryLabel: 'Аренда',
  amountKopecks: 3_000_000,
  fromDay: '2026-10-01',
  toDay: null,
  note: null,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.allocation.mockResolvedValue({ from: '', to: '', totalKopecks: 0, byCategory: [] });
  const pinia = createPinia();
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useExpenseDialog', () => {
  it('новый расход: форма с сегодняшним днём, удача закрывает диалог', async () => {
    const dialog = useExpenseDialog(() => '2026-10-15');
    dialog.openCreate();
    expect(dialog.title.value).toBe('Новый расход');
    expect(dialog.form.value.fromDay).toBe('2026-10-15');

    dialog.form.value = { ...dialog.form.value, amount: '30 000' };
    api.create.mockResolvedValueOnce(VIEW);
    await dialog.save();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ amount: '30 000' }));
    expect(dialog.open.value).toBe(false);
  });

  it('правка шлёт PUT своей записи; ошибка поля — под поле, диалог остаётся', async () => {
    const dialog = useExpenseDialog(() => '2026-10-15');
    dialog.openEdit(rent);
    expect(dialog.title.value).toBe('Изменить расход');
    api.update.mockRejectedValueOnce(
      new ApiError('Окончание раньше начала', 400, 'INVALID_EXPENSE', 'toDay'),
    );
    await dialog.save();
    expect(api.update).toHaveBeenCalledWith('e1', expect.objectContaining({ amount: '30000' }));
    expect(dialog.errors.value).toEqual({ toDay: 'Окончание раньше начала' });
    expect(dialog.open.value).toBe(true);
    expect(dialog.busy.value).toBe(false);
  });
});
