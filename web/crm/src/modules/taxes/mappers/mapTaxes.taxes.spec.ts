import type { TaxesView } from '../taxes.domain';

import { describe, expect, it } from 'vitest';

import {
  formatRate,
  isSameForm,
  mapTaxError,
  regimeOptions,
  taxBody,
  toTaxForm,
  withRegime,
} from './mapTaxes.taxes';

import { ApiError } from '@/shared/http';

const VIEW: TaxesView = {
  settings: { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' },
  isDefault: true,
  updatedAt: null,
  regimes: [
    {
      key: 'usn_income',
      label: 'УСН «Доходы»',
      selectable: true,
      defaultRateBasisPoints: 600,
      maxRateBasisPoints: 600,
    },
    {
      key: 'usn_income_minus_expenses',
      label: 'УСН «Доходы минус расходы»',
      selectable: true,
      defaultRateBasisPoints: 1500,
      maxRateBasisPoints: 1500,
    },
    {
      key: 'osno',
      label: 'ОСНО',
      selectable: false,
      defaultRateBasisPoints: null,
      maxRateBasisPoints: null,
    },
  ],
  recognitions: [
    { key: 'payment', label: 'По дате поступления денег' },
    { key: 'realization', label: 'По дате реализации' },
  ],
  minimumTaxBasisPoints: 100,
};

describe('мапперы «Налогов»', () => {
  it('ставка из сотых долей — как её вводят', () => {
    expect(formatRate(600)).toBe('6');
    expect(formatRate(450)).toBe('4,5');
    expect(formatRate(25)).toBe('0,25');
    expect(formatRate(0)).toBe('0');
  });

  it('форма из вида и тело запроса', () => {
    const form = toTaxForm(VIEW);
    expect(form).toEqual({ regime: 'usn_income', rate: '6', recognition: 'payment' });
    expect(taxBody({ ...form, rate: ' 4,5 ' })).toEqual({ ...form, rate: '4,5' });
    expect(isSameForm(form, { ...form, rate: '6 ' })).toBe(true);
  });

  it('невыбираемые режимы в форму не попадают', () => {
    expect(regimeOptions(VIEW).map((option) => option.value)).toEqual([
      'usn_income',
      'usn_income_minus_expenses',
    ]);
  });

  it('смена режима подставляет его ставку, если ставку не трогали', () => {
    const form = toTaxForm(VIEW);
    expect(withRegime(VIEW, form, 'usn_income_minus_expenses').rate).toBe('15');
    expect(withRegime(VIEW, { ...form, rate: '4' }, 'usn_income_minus_expenses').rate).toBe('4');
  });

  it('ошибка с полем — под поле, без — общей плашкой', () => {
    const fieldError = new ApiError('Ставка не выше 6 %', 400, 'INVALID_TAX_SETTING', 'rate');
    expect(mapTaxError(fieldError, 'x')).toEqual({ rate: 'Ставка не выше 6 %' });
    expect(mapTaxError(new Error('сеть'), 'x')).toEqual({ form: 'сеть' });
  });
});
