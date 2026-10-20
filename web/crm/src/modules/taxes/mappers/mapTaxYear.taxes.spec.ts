import type { TaxYearPeriod, TaxYearResponse } from '../taxes.domain';

import { describe, expect, it } from 'vitest';

import {
  formatParam,
  mapTaxYearError,
  reconciliationBody,
  reductionBody,
  taxYearOptions,
  toLimitBars,
  toPeriodRow,
  toReconciliationForm,
  toReductionForm,
} from './mapTaxYear.taxes';

import { ApiError } from '@/shared/http';

const PERIOD: TaxYearPeriod = {
  key: 'h1',
  label: 'Полугодие',
  from: '2026-01-01',
  to: '2026-06-30',
  fullTo: '2026-06-30',
  closed: true,
  incomeKopecks: 100_000_00,
  taxKopecks: 600_000,
  minimumApplied: false,
  reductionsPaidKopecks: 100_000,
  reductionKopecks: 100_000,
  reductionLimitKopecks: 600_000,
  dueKopecks: 500_000,
  advanceKopecks: -20_000,
  reconciliation: null,
};

const VIEW = {
  incomeKopecks: 1_700_000_000,
  forecast: { incomeKopecks: 2_400_000_000, basisDays: 200 },
  approachShare: 0.8,
  limits: [
    { key: 'usn', label: 'Лимит дохода УСН', valueKopecks: 49_050_000_000 },
    { key: 'vat', label: 'Порог НДС на УСН', valueKopecks: 2_000_000_000 },
  ],
} as TaxYearResponse;

describe('маппер вкладки «Год»', () => {
  it('годы — текущий и три прошлых, новые первыми', () => {
    expect(taxYearOptions('2026-10-17').map((o) => o.value)).toEqual([2026, 2025, 2024, 2023]);
  });

  it('строка периода: аванс к зачёту без минуса, уменьшение — только когда действует', () => {
    const row = toPeriodRow(PERIOD, true);
    expect(row.range).toBe('01-01-2026 — 30-06-2026');
    expect(row.advanceNegative).toBe(true);
    expect(row.advance).not.toContain('-');
    expect(row.reduction).not.toBeNull();
    expect(toPeriodRow(PERIOD, false).reduction).toBeNull();
    expect(row.reconciliation).toBeNull();
  });

  it('сверка в строке: расхождение со знаком, ноль — «сверено» без расхождения', () => {
    const base = {
      accountantTaxKopecks: null,
      checked: true,
      note: null,
      checkedAt: null,
      taxDiffKopecks: null,
    };
    const diff = toPeriodRow(
      {
        ...PERIOD,
        reconciliation: { ...base, accountantIncomeKopecks: 1, incomeDiffKopecks: 50_000 },
      },
      true,
    );
    expect(diff.reconciliation).toMatchObject({ checked: true, hasDiff: true });
    expect(diff.reconciliation?.diff).toContain('+');
    const same = toPeriodRow(
      { ...PERIOD, reconciliation: { ...base, accountantIncomeKopecks: 1, incomeDiffKopecks: 0 } },
      true,
    );
    expect(same.reconciliation?.hasDiff).toBe(false);
  });

  it('полосы лимитов: доля от порога и тон — по порогу сервера', () => {
    const [usn, vat] = toLimitBars(VIEW);
    expect(usn).toMatchObject({ tone: 'ok' });
    expect(vat?.share).toBeCloseTo(0.85);
    expect(vat?.tone).toBe('warn');
    const none = toLimitBars({
      ...VIEW,
      limits: [{ key: 'usn', label: 'Лимит', valueKopecks: null }],
    });
    expect(none[0]).toMatchObject({ value: null, share: null, tone: 'ok' });
  });

  it('параметр года: суммы — рубли, доли — проценты, нет — «не задано»', () => {
    expect(formatParam({ unit: 'basisPoints', value: 5000 })).toBe('50 %');
    expect(formatParam({ unit: 'basisPoints', value: 450 })).toBe('4,5 %');
    expect(formatParam({ unit: 'kopecks', value: null })).toBe('не задано');
  });

  it('формы и тела: пустой ввод — null, правка — рубли из копеек', () => {
    expect(toReductionForm(null, '2026-10-17')).toEqual({
      paidDay: '2026-10-17',
      kind: 'insurance_fixed',
      amount: '',
      note: '',
    });
    expect(
      reductionBody({ paidDay: '2026-03-01', kind: 'other', amount: ' 5 ', note: ' ' }),
    ).toEqual({
      paidDay: '2026-03-01',
      kind: 'other',
      amount: '5',
      note: null,
    });
    const form = toReconciliationForm({
      ...PERIOD,
      reconciliation: {
        accountantIncomeKopecks: 123_450,
        accountantTaxKopecks: null,
        checked: true,
        note: null,
        checkedAt: null,
        incomeDiffKopecks: 0,
        taxDiffKopecks: null,
      },
    });
    expect(form).toEqual({
      accountantIncome: '1234,5',
      accountantTax: '',
      checked: true,
      note: '',
    });
    expect(reconciliationBody(form)).toEqual({
      accountantIncome: '1234,5',
      accountantTax: null,
      checked: true,
      note: null,
    });
  });

  it('ошибка с полем — под поле, иначе — общая', () => {
    const field = new ApiError(
      'Сумма должна быть больше нуля',
      400,
      'INVALID_TAX_YEAR_INPUT',
      'amount',
    );
    expect(mapTaxYearError(field, 'x')).toEqual({ amount: 'Сумма должна быть больше нуля' });
    expect(mapTaxYearError(new Error('сеть'), 'x')).toEqual({ form: 'сеть' });
  });
});
