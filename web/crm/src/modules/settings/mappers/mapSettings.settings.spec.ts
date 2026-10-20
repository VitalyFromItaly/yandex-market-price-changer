import type { Settings } from '../settings.domain';

import { describe, expect, it } from 'vitest';

import {
  isEmptyDiff,
  mapSettingsError,
  profitDiff,
  promoBody,
  toProfitForm,
  toPromoForm,
} from './mapSettings.settings';

import { ApiError } from '@/shared/http';

const SETTINGS: Settings = {
  commissionPercent: 23,
  taxPercent: 7,
  discountPercent: 10,
  brands: [
    { key: 'casio', title: 'CASIO', count: 3, discountPercent: 10 },
    { key: 'vostok', title: 'Восток', count: 2, discountPercent: 4.5 },
  ],
  otherCount: 1,
  promotion: null,
};

describe('profitDiff', () => {
  it('нетронутая форма — пустой дифф', () => {
    expect(isEmptyDiff(profitDiff(SETTINGS, toProfitForm(SETTINGS)))).toBe(true);
  });

  it('дробь пишется через запятую и обратно разбирается', () => {
    expect(toProfitForm(SETTINGS).brands.vostok).toBe('4,5');
  });

  it('уходят только изменённые поля — нетронутый бренд не становится явным решением', () => {
    const form = toProfitForm(SETTINGS);
    form.taxPercent = '6';
    form.brands.casio = '5,5';
    expect(profitDiff(SETTINGS, form)).toEqual({ taxPercent: 6, brandDiscounts: { casio: 5.5 } });
  });

  it('нечисло уходит строкой — отказ формулирует сервер', () => {
    const form = toProfitForm(SETTINGS);
    form.commissionPercent = 'много';
    expect(profitDiff(SETTINGS, form)).toEqual({ commissionPercent: 'много' });
  });
});

describe('промо: форма ↔ тело', () => {
  it('пустой порог — null (порога нет), рубли с разрядами и ₽ — число', () => {
    const form = toPromoForm(null);
    expect(form.mode).toBe('flat');
    expect(promoBody({ ...form, percent: '2' })).toEqual({ mode: 'flat', percent: 2, from: null });
    expect(
      promoBody({
        ...form,
        mode: 'tiered',
        limit: '10 000 ₽',
        below: '2',
        above: '1',
        from: '3 000',
      }),
    ).toEqual({ mode: 'tiered', limit: 10000, below: 2, above: 1, from: 3000 });
  });

  it('сохранённая ступенчатая настройка раскладывается по полям', () => {
    expect(
      toPromoForm({ mode: 'tiered', limit: 10000, below: 2, above: 1, from: 3000 }),
    ).toMatchObject({ mode: 'tiered', limit: '10000', below: '2', above: '1', from: '3000' });
  });
});

describe('mapSettingsError', () => {
  it('поле сервера → поле формы; скидка бренда — brand:<ключ>', () => {
    const tax = new ApiError('Налог…', 400, 'INVALID_SETTING', 'taxPercent');
    expect(mapSettingsError(tax, 'x')).toEqual({ taxPercent: 'Налог…' });

    const brand = new ApiError('Скидка…', 400, 'INVALID_SETTING', 'brandDiscounts.casio');
    expect(mapSettingsError(brand, 'x')).toEqual({ 'brand:casio': 'Скидка…' });
  });

  it('без поля — общая ошибка формы', () => {
    expect(mapSettingsError(new ApiError('Нет связи', 0), 'x')).toEqual({ form: 'Нет связи' });
    expect(mapSettingsError('???', 'Не удалось')).toEqual({ form: 'Не удалось' });
  });
});
