import type { TaxesView } from '../taxes.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { useTaxesStore } from '../store/store.taxes';

import { useTaxForm } from './useTaxForm.taxes';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../api/taxesApi.taxes', () => ({ taxesApi: api }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const regime = (key: 'usn_income' | 'usn_income_minus_expenses', rate: number) => ({
  key,
  label: key,
  selectable: true,
  defaultRateBasisPoints: rate,
  maxRateBasisPoints: rate,
});
const VIEW: TaxesView = {
  settings: { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' },
  isDefault: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  regimes: [regime('usn_income', 600), regime('usn_income_minus_expenses', 1500)],
  recognitions: [
    { key: 'payment', label: 'По поступлению' },
    { key: 'realization', label: 'По реализации' },
  ],
  minimumTaxBasisPoints: 100,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia();
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

async function loaded(view: TaxesView) {
  api.get.mockResolvedValueOnce(view);
  await useTaxesStore().load();
  const form = useTaxForm();
  await nextTick();
  return form;
}

describe('useTaxForm', () => {
  it('без правок сохранять нечего; умолчание — можно подтвердить', async () => {
    expect((await loaded(VIEW)).dirty.value).toBe(false);
    expect((await loaded({ ...VIEW, isDefault: true })).dirty.value).toBe(true);
  });

  it('смена режима ставит его ставку, запись пересобирает форму из ответа', async () => {
    const form = await loaded(VIEW);
    form.chooseRegime('usn_income_minus_expenses');
    expect(form.form.value).toEqual({
      regime: 'usn_income_minus_expenses',
      rate: '15',
      recognition: 'payment',
    });
    const saved: TaxesView = {
      ...VIEW,
      settings: {
        regime: 'usn_income_minus_expenses',
        rateBasisPoints: 1500,
        recognition: 'payment',
      },
    };
    api.save.mockResolvedValueOnce(saved);
    await form.submit();
    expect(api.save).toHaveBeenCalledWith({
      regime: 'usn_income_minus_expenses',
      rate: '15',
      recognition: 'payment',
    });
    await nextTick();
    expect(form.dirty.value).toBe(false);
  });

  it('ошибка сервера с полем встаёт под поле', async () => {
    const form = await loaded(VIEW);
    if (form.form.value) form.form.value.rate = '7';
    api.save.mockRejectedValueOnce(
      new ApiError('Ставка не выше 6 %', 400, 'INVALID_TAX_SETTING', 'rate'),
    );
    await form.submit();
    expect(form.errors.value).toEqual({ rate: 'Ставка не выше 6 %' });
    expect(form.busy.value).toBe(false);
  });
});
