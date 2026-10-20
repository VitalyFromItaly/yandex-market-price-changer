import type { ITaxResult } from '../../src/modules/finance/tax';
import type { ITaxYearInput } from '../../src/modules/finance/tax-year';
import type { ITaxYearParams } from '../../src/modules/finance/tax-year.domain';

import { describe, expect, it } from 'vitest';

import { taxOf } from '../../src/modules/finance/tax';
import {
  daysInYear,
  forecastOf,
  reportingPeriodsOf,
  TAX_YEAR_THRESHOLDS,
  taxYearOf,
} from '../../src/modules/finance/tax-year';
import {
  isTaxYearInRange,
  validateTaxReconciliationInput,
  validateTaxReductionInput,
  validateTaxYearParamsInput,
} from '../../src/modules/finance/tax-year.domain';

/** Налоговый модуль ИП (TASK-146): периоды, авансы, уменьшения, лимиты, прогноз. */

const USN_6 = { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' } as const;
const USN_15 = {
  regime: 'usn_income_minus_expenses',
  rateBasisPoints: 1500,
  recognition: 'payment',
} as const;

const PARAMS: ITaxYearParams = {
  year: 2026,
  usnIncomeLimitKopecks: 49_050_000_000,
  vatThresholdKopecks: 2_000_000_000,
  insuranceFixedKopecks: 5_739_000,
  insuranceExtraCapKopecks: 32_181_800,
  reductionLimitWithStaffBasisPoints: 5000,
  maxRateUsnIncomeBasisPoints: 600,
  maxRateUsnIncomeMinusExpensesBasisPoints: 1500,
  sourceNote: null,
};

const tax = (incomeKopecks: number, over: Partial<ITaxResult> = {}): ITaxResult => {
  const regular = Math.round(incomeKopecks * 0.06);
  return {
    incomeKopecks,
    deductibleKopecks: 0,
    baseKopecks: incomeKopecks,
    regularKopecks: regular,
    minimumKopecks: 0,
    taxKopecks: regular,
    minimumApplied: false,
    undatedLines: 0,
    ...over,
  };
};

function input(over: Partial<ITaxYearInput> = {}, incomes = [100_000_00, 250_000_00, 400_000_00]) {
  const today = over.today ?? '2026-10-15';
  const periods = reportingPeriodsOf(2026, today).map((range, i) => ({
    ...range,
    tax: tax(incomes[i] ?? incomes[incomes.length - 1]),
  }));
  return {
    year: 2026,
    today,
    settings: USN_6,
    hasStaff: false,
    params: PARAMS,
    periods,
    reductions: [],
    payments: [],
    reconciliations: [],
    ...over,
  } as ITaxYearInput;
}

describe('отчётные периоды', () => {
  it('нарастающим итогом с 1 января; идущий период обрезан сегодняшним днём', () => {
    expect(reportingPeriodsOf(2026, '2026-10-15')).toEqual([
      { key: 'q1', from: '2026-01-01', to: '2026-03-31', fullTo: '2026-03-31', closed: true },
      { key: 'h1', from: '2026-01-01', to: '2026-06-30', fullTo: '2026-06-30', closed: true },
      { key: 'm9', from: '2026-01-01', to: '2026-09-30', fullTo: '2026-09-30', closed: true },
      { key: 'y', from: '2026-01-01', to: '2026-10-15', fullTo: '2026-12-31', closed: false },
    ]);
    expect(reportingPeriodsOf(2026, '2026-02-10').map((p) => p.key)).toEqual(['q1']);
    expect(reportingPeriodsOf(2026, '2025-12-31')).toEqual([]);
    expect(reportingPeriodsOf(2025, '2026-10-15').every((p) => p.closed)).toBe(true);
  });

  it('год модуля — текущий и три прошлых', () => {
    expect(isTaxYearInRange(2026, 2026)).toBe(true);
    expect(isTaxYearInRange(2023, 2026)).toBe(true);
    expect(isTaxYearInRange(2022, 2026)).toBe(false);
    expect(isTaxYearInRange(2027, 2026)).toBe(false);
    expect(isTaxYearInRange('2026', 2026)).toBe(false);
  });
});

describe('налог года', () => {
  it('УСН 6 % — от дохода ДО комиссий площадки: 10 000 ₽ продажи и −2 300 ₽ комиссии дают 600 ₽', () => {
    const lines = [
      { article: 'sales', amountKopecks: 1_000_000, paidDay: '2026-03-10', realizedDay: '2026-03-05' },
      { article: 'commission', amountKopecks: -230_000, paidDay: '2026-03-10', realizedDay: '2026-03-05' },
    ] as const;
    const q1 = taxOf(USN_6, lines, { from: '2026-01-01', to: '2026-03-31' });
    const year = taxYearOf(
      input({ today: '2026-04-15', periods: [{ ...reportingPeriodsOf(2026, '2026-04-15')[0], tax: q1 }] }),
    );
    expect(year.periods[0].incomeKopecks).toBe(1_000_000);
    expect(year.periods[0].taxKopecks).toBe(60_000);
    expect(year.periods[0].dueKopecks).toBe(60_000);
  });

  it('аванс периода — налог нарастающим итогом минус начисленное за прошлые', () => {
    const year = taxYearOf(input());
    expect(year.periods.map((p) => p.dueKopecks)).toEqual([600_000, 1_500_000, 2_400_000, 2_400_000]);
    expect(year.periods.map((p) => p.advanceKopecks)).toEqual([600_000, 900_000, 900_000, 0]);
    expect(year.incomeKopecks).toBe(400_000_00);
  });

  it('уменьшение на взносы: без работников — до всего налога, с работниками — до 50 %', () => {
    const reductions = [{ paidDay: '2026-03-20', kind: 'insurance_fixed', amountKopecks: 1_000_000 }] as const;
    const alone = taxYearOf(input({ reductions }));
    // 10 000 ₽ взносов против 6 000 ₽ налога Q1 — налог Q1 ноль, остаток уменьшает полугодие.
    expect(alone.periods[0]).toMatchObject({ reductionKopecks: 600_000, dueKopecks: 0 });
    expect(alone.periods[1]).toMatchObject({ reductionKopecks: 1_000_000, dueKopecks: 500_000 });

    const staff = taxYearOf(input({ reductions, hasStaff: true }));
    expect(staff.periods[0]).toMatchObject({ reductionLimitKopecks: 300_000, reductionKopecks: 300_000, dueKopecks: 300_000 });
  });

  it('взнос уплачен после периода — уменьшает следующий, не этот', () => {
    const year = taxYearOf(
      input({ reductions: [{ paidDay: '2026-04-02', kind: 'insurance_fixed', amountKopecks: 100_000 }] }),
    );
    expect(year.periods[0].reductionKopecks).toBe(0);
    expect(year.periods[1].reductionKopecks).toBe(100_000);
  });

  it('с работниками без строки года уменьшения нет — налог не занижается по угаданной доле', () => {
    const year = taxYearOf(
      input({
        params: null,
        hasStaff: true,
        reductions: [{ paidDay: '2026-03-20', kind: 'insurance_fixed', amountKopecks: 100_000 }],
      }),
    );
    expect(year.periods[0].reductionKopecks).toBe(0);
    expect(year.warnings.map((w) => w.key)).toContain('params_missing');
  });

  it('«Доходы минус расходы»: взносы налог не уменьшают; минимальный налог — только у года', () => {
    const minimumTax = tax(100_000_00, { regularKopecks: 10_000, minimumKopecks: 100_000, taxKopecks: 100_000, minimumApplied: true });
    const periods = reportingPeriodsOf(2026, '2026-10-15').map((range) => ({ ...range, tax: minimumTax }));
    const year = taxYearOf(
      input({
        settings: USN_15,
        periods,
        reductions: [{ paidDay: '2026-03-20', kind: 'insurance_fixed', amountKopecks: 1_000_000 }],
      }),
    );
    expect(year.periods.map((p) => p.reductionLimitKopecks)).toEqual([null, null, null, null]);
    expect(year.periods.slice(0, 3).map((p) => p.taxKopecks)).toEqual([10_000, 10_000, 10_000]);
    expect(year.periods[3]).toMatchObject({ taxKopecks: 100_000, minimumApplied: true });
  });

  it('уплачено — уплаты календарного года; остаток = к уплате − уплачено', () => {
    const year = taxYearOf(
      input({
        payments: [
          { paidDay: '2026-04-25', amountKopecks: 600_000 },
          { paidDay: '2026-07-25', amountKopecks: 900_000 },
        ],
      }),
    );
    expect(year.paidKopecks).toBe(1_500_000);
    expect(year.balanceKopecks).toBe(2_400_000 - 1_500_000);
  });

  it('сверка: расхождение = наше − бухгалтерия, null без суммы бухгалтера', () => {
    const year = taxYearOf(
      input({
        reconciliations: [
          {
            period: 'h1',
            accountantIncomeKopecks: 249_000_00,
            accountantTaxKopecks: null,
            checked: true,
            note: null,
            checkedAt: new Date('2026-07-10T00:00:00Z'),
          },
        ],
      }),
    );
    expect(year.periods[0].reconciliation).toBeNull();
    expect(year.periods[1].reconciliation).toMatchObject({
      checked: true,
      incomeDiffKopecks: 1_000_00,
      taxDiffKopecks: null,
    });
  });
});

describe('прогноз и предупреждения', () => {
  it('прогноз — линейно по дням и помечен «forecast»; у закрытого года его нет', () => {
    const forecast = forecastOf(2026, 1_000_000, '2026-07-02');
    expect(forecast?.kind).toBe('forecast');
    expect(forecast?.basisDays).toBe(183);
    expect(forecast?.incomeKopecks).toBe(Math.round((1_000_000 * daysInYear(2026)) / 183));
    expect(taxYearOf(input({ today: '2027-01-10' })).forecast).toBeNull();
  });

  it('доход ≥ 80 % порога НДС — «приближается», выше — «превышен», прогноз выше — «по прогнозу»', () => {
    const vat = PARAMS.vatThresholdKopecks as number;
    const levels = (income: number, today = '2026-10-15') =>
      taxYearOf(input({ today }, [income, income, income, income]))
        .warnings.filter((w) => w.key.startsWith('vat'))
        .map((w) => w.level);
    expect(levels(vat * TAX_YEAR_THRESHOLDS.approachShare)).toEqual(['approaching']);
    expect(levels(vat + 1)).toEqual(['exceeded']);
    // 15 млн к началу июля — к концу года по прогнозу почти 30 млн.
    expect(levels(1_500_000_000, '2026-07-02')).toEqual(['forecast_exceeds']);
    expect(levels(100_000_00)).toEqual([]);
  });

  it('параметры года — данные: другой порог в строке меняет предупреждение без кода', () => {
    const income = 1_000_000_000;
    const strict = taxYearOf(input({ params: { ...PARAMS, vatThresholdKopecks: 900_000_000 } }, [income]));
    const loose = taxYearOf(input({ params: { ...PARAMS, vatThresholdKopecks: 90_000_000_000 } }, [income]));
    expect(strict.warnings.map((w) => w.key)).toContain('vat_exceeded');
    expect(loose.warnings.map((w) => w.key).filter((k) => k.startsWith('vat'))).toEqual([]);
  });

  it('ставка выше предельной года и строки без даты — предупреждения-справки', () => {
    const periods = reportingPeriodsOf(2026, '2026-02-01').map((range) => ({
      ...range,
      tax: tax(100, { undatedLines: 3 }),
    }));
    const year = taxYearOf(
      input({
        today: '2026-02-01',
        periods,
        settings: { ...USN_6, rateBasisPoints: 600 },
        params: { ...PARAMS, maxRateUsnIncomeBasisPoints: 400 },
      }),
    );
    expect(year.warnings.map((w) => w.key)).toEqual(expect.arrayContaining(['rate_above_max', 'undated']));
  });
});

describe('проверка ввода', () => {
  it('строка года: рубли → копейки, проценты → сотые доли, пусто → «не задано»', () => {
    const checked = validateTaxYearParamsInput(2028, {
      usnIncomeLimitKopecks: '500 000 000',
      reductionLimitWithStaffBasisPoints: '50',
      vatThresholdKopecks: '',
    });
    expect(checked).toMatchObject({
      ok: true,
      value: {
        year: 2028,
        usnIncomeLimitKopecks: 50_000_000_000,
        reductionLimitWithStaffBasisPoints: 5000,
        vatThresholdKopecks: null,
      },
    });
    expect(validateTaxYearParamsInput(1999, {})).toMatchObject({ ok: false, field: 'year' });
    expect(validateTaxYearParamsInput(2028, { maxRateUsnIncomeBasisPoints: '101' })).toMatchObject({
      ok: false,
      field: 'maxRateUsnIncomeBasisPoints',
    });
  });

  it('уменьшение и сверка', () => {
    expect(validateTaxReductionInput({ paidDay: '2026-03-01', kind: 'other', amount: '0' })).toMatchObject({
      ok: false,
      field: 'amount',
    });
    expect(validateTaxReductionInput({ paidDay: '1.03.2026', kind: 'other', amount: '5' })).toMatchObject({
      ok: false,
      field: 'paidDay',
    });
    expect(validateTaxReconciliationInput({ checked: false })).toEqual({
      ok: true,
      value: { accountantIncomeKopecks: null, accountantTaxKopecks: null, checked: false, note: null },
    });
    expect(validateTaxReconciliationInput({ checked: true, accountantTax: '-1' })).toMatchObject({
      ok: false,
      field: 'accountantTax',
    });
  });
});
