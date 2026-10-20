import type { ProfitForm, Settings } from '../settings.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { useSettingsStore } from '../store/store.settings';

import { useProfitForm } from './useProfitForm.settings';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  saveProfit: vi.fn(),
  savePromotion: vi.fn(),
  disablePromotion: vi.fn(),
}));
vi.mock('../api/settingsApi.settings', () => ({ settingsApi: api }));

const SETTINGS: Settings = {
  commissionPercent: 23,
  taxPercent: 7,
  discountPercent: 10,
  brands: [{ key: 'casio', title: 'CASIO', count: 1, discountPercent: 10 }],
  otherCount: 0,
  promotion: null,
};

beforeEach(async () => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia();
  createApp({}).use(pinia);
  setActivePinia(pinia);
  api.get.mockResolvedValueOnce(SETTINGS);
  await useSettingsStore().load();
});

/** Форма загружена в beforeEach — null здесь означал бы сломанный тест. */
function filled(form: { value: ProfitForm | null }): ProfitForm {
  if (form.value === null) throw new Error('форма не загружена');
  return form.value;
}

describe('useProfitForm', () => {
  it('без правок сохранять нечего; после правки уходит только изменённое', async () => {
    const { form, dirty, submit } = useProfitForm();
    expect(dirty.value).toBe(false);

    filled(form).brands.casio = '5';
    expect(dirty.value).toBe(true);

    api.saveProfit.mockResolvedValueOnce({
      ...SETTINGS,
      brands: [{ ...SETTINGS.brands[0], discountPercent: 5 }],
    });
    await submit();
    await nextTick();

    expect(api.saveProfit).toHaveBeenCalledWith({ brandDiscounts: { casio: 5 } });
    // Форма пересобрана из сохранённого — больше не «грязная».
    expect(dirty.value).toBe(false);
  });

  it('отказ сервера встаёт под своё поле, введённое не теряется', async () => {
    const { form, errors, submit } = useProfitForm();
    filled(form).taxPercent = '200';
    api.saveProfit.mockRejectedValueOnce(
      new ApiError('Налог с продаж указывается…', 400, 'INVALID_SETTING', 'taxPercent'),
    );
    await submit();

    expect(errors.value).toEqual({ taxPercent: 'Налог с продаж указывается…' });
    expect(filled(form).taxPercent).toBe('200');
  });
});
