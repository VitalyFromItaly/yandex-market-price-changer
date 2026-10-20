import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TAX_SETTINGS,
  parseRatePercent,
  validateTaxSettingsInput,
} from '../../src/modules/finance/tax.domain';

describe('налоговые настройки: проверка ввода', () => {
  it('ставка — проценты в сотые доли, не больше двух знаков', () => {
    expect(parseRatePercent('6')).toBe(600);
    expect(parseRatePercent('4,5')).toBe(450);
    expect(parseRatePercent(' 0.25 % ')).toBe(25);
    expect(parseRatePercent(7.5)).toBe(750);
    expect(parseRatePercent('1,255')).toBeNull();
    expect(parseRatePercent('-1')).toBeNull();
    expect(parseRatePercent('шесть')).toBeNull();
    expect(parseRatePercent(null)).toBeNull();
  });

  it('пустой ввод — текущие настройки как есть', () => {
    expect(validateTaxSettingsInput({}, DEFAULT_TAX_SETTINGS)).toEqual({
      ok: true,
      value: DEFAULT_TAX_SETTINGS,
    });
  });

  it('смена режима без ставки берёт общую ставку режима', () => {
    const result = validateTaxSettingsInput(
      { regime: 'usn_income_minus_expenses' },
      DEFAULT_TAX_SETTINGS,
    );
    expect(result).toEqual({
      ok: true,
      value: { regime: 'usn_income_minus_expenses', rateBasisPoints: 1500, recognition: 'payment' },
    });
  });

  it('0 % допустим — налоговые каникулы', () => {
    const result = validateTaxSettingsInput({ rate: '0' }, DEFAULT_TAX_SETTINGS);
    expect(result.ok && result.value.rateBasisPoints).toBe(0);
  });

  it.each([
    [{ regime: 'osno' }, 'regime'],
    [{ regime: 'npd' }, 'regime'],
    [{ regime: 'patent' }, 'regime'],
    [{ recognition: 'accrual' }, 'recognition'],
    [{ rate: '6,01' }, 'rate'],
    [{ rate: '6,125' }, 'rate'],
    [{ regime: 'usn_income_minus_expenses', rate: '16' }, 'rate'],
    [{ rate: 'abc' }, 'rate'],
  ])('%j → ошибка поля %s', (input, field) => {
    const result = validateTaxSettingsInput(input, DEFAULT_TAX_SETTINGS);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.field).toBe(field);
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
