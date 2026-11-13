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
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast: toastMock }));

const VIEW: ExpensesView = {
  categories: [],
  scopes: [],
  expenses: [],
  limits: {
    noteMaxLength: 200,
    categoryNameMaxLength: 60,
    sourceMaxLength: 200,
    refMaxLength: 100,
  },
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
  source: null,
  scope: 'business',
  scopeLabel: 'Весь бизнес',
  marketplace: null,
  orderId: null,
  sku: null,
  doubleCount: null,
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
    api.create.mockResolvedValueOnce({ ...VIEW, warning: null });
    await dialog.save();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ amount: '30 000' }));
    expect(dialog.open.value).toBe(false);
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it('двойной учёт: запись сохранена, диалог закрыт, предупреждение — отдельным тостом', async () => {
    toastMock.info.mockReset();
    const dialog = useExpenseDialog(() => '2026-10-15');
    dialog.openCreate();
    dialog.form.value = {
      ...dialog.form.value,
      category: 'marketplace_subscriptions',
      amount: '1990',
    };
    api.create.mockResolvedValueOnce({
      ...VIEW,
      warning: 'Площадка уже начисляет «Абонентская плата»',
    });
    await dialog.save();
    expect(dialog.open.value).toBe(false);
    expect(toastMock.info).toHaveBeenCalledWith(
      'Проверьте двойной учёт',
      'Площадка уже начисляет «Абонентская плата»',
    );
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
