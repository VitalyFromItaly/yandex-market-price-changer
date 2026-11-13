import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { costHistoryView, costRecord } from '../mappers/costHistory.fixtures.accounting';
import { useAccountingStore } from '../store/store.accounting';

import { useCostCorrectionDialog } from './useCostCorrectionDialog.accounting';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({
  costProducts: vi.fn(),
  costHistory: vi.fn(),
  correctCost: vi.fn(),
}));
vi.mock('../api/accountingApi.accounting', () => ({ accountingApi: api }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = () => new Date('2026-11-11T10:00:00.000Z');

beforeEach(async () => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia();
  createApp({}).use(pinia);
  setActivePinia(pinia);
  api.costHistory.mockResolvedValue(costHistoryView());
  await useAccountingStore().selectCostProduct({ id: 'p1', internalSku: 'A1', name: 'Часы' });
});

describe('useCostCorrectionDialog', () => {
  it('без причины — ошибка под «Причиной» из 400, диалог открыт; с причиной — закрыт', async () => {
    const dialog = useCostCorrectionDialog(NOW);
    dialog.openFor(costRecord());
    dialog.form.value = { ...dialog.form.value, price: '900' };

    api.correctCost.mockRejectedValueOnce(
      new ApiError('Укажите причину исправления', 400, 'INVALID_COST_CORRECTION', 'reason'),
    );
    await dialog.save();
    expect(dialog.errors.value).toEqual({ reason: 'Укажите причину исправления' });
    expect(dialog.open.value).toBe(true);

    const updated = costHistoryView({ records: [costRecord({ id: 'n' })] });
    api.correctCost.mockResolvedValueOnce(updated);
    dialog.form.value = { ...dialog.form.value, reason: 'Счёт поставщика' };
    await dialog.save();
    expect(dialog.open.value).toBe(false);
    expect(dialog.errors.value).toEqual({});
    expect(api.correctCost).toHaveBeenLastCalledWith('p1', {
      validFrom: '2026-10-01T09:15:42.123Z',
      price: '900',
      currency: 'RUR',
      rate: null,
      extraCosts: null,
      reason: 'Счёт поставщика',
    });
    expect(useAccountingStore().costHistory).toEqual(updated);
  });

  it('новое открытие сбрасывает ошибки; без записи — текущая минута', () => {
    const dialog = useCostCorrectionDialog(NOW);
    dialog.errors.value = { price: 'x' };
    dialog.openFor(null);
    expect(dialog.errors.value).toEqual({});
    expect(dialog.form.value.validFrom).toBe('2026-11-11T13:00');
    expect(dialog.open.value).toBe(true);
  });

  it('чужой товар (404) — общей строкой формы', async () => {
    const dialog = useCostCorrectionDialog(NOW);
    dialog.openFor(null);
    api.correctCost.mockRejectedValueOnce(
      new ApiError('Товар не найден', 404, 'COST_PRODUCT_NOT_FOUND'),
    );
    await dialog.save();
    expect(dialog.errors.value).toEqual({ form: 'Товар не найден' });
  });
});
