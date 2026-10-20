/**
 * Налоговый модуль ИП (TASK-146, ТЗ п.12): отчётные периоды, параметры года,
 * уменьшения налога и сверка с бухгалтерией — типы и проверка ввода. Чистые
 * функции, без Nest и базы; расчёт — `tax-year.ts`.
 *
 * Параметры года — ДАННЫЕ (решение `tax_year_params_global_admin`): лимит УСН,
 * порог НДС, взносы и предельные ставки меняются законом каждый год, и смена
 * года не должна требовать деплоя. Поэтому здесь только форма строки и её
 * проверка, ни одного числа закона.
 */

import { isIsoDay, MAX_EXPENSE_KOPECKS } from './expense.domain';
import { toKopecks } from './kopecks';

/**
 * Отчётные периоды УСН нарастающим итогом (решение `tax_year_reporting_periods`):
 * авансы считаются за I квартал, полугодие и 9 месяцев, налог — за год.
 */
export const TAX_YEAR_PERIODS = ['q1', 'h1', 'm9', 'y'] as const;
export type TTaxYearPeriod = (typeof TAX_YEAR_PERIODS)[number];

export const TAX_YEAR_PERIOD_LABELS: Record<TTaxYearPeriod, string> = {
  q1: 'I квартал',
  h1: 'Полугодие',
  m9: '9 месяцев',
  y: 'Год',
};

/** Последний день периода «ММ-ДД». */
export const TAX_YEAR_PERIOD_END: Record<TTaxYearPeriod, string> = {
  q1: '03-31',
  h1: '06-30',
  m9: '09-30',
  y: '12-31',
};

export function isTaxYearPeriod(value: unknown): value is TTaxYearPeriod {
  return typeof value === 'string' && (TAX_YEAR_PERIODS as readonly string[]).includes(value);
}

/** Сколько лет назад модуль ещё считает: прошлые годы сверяют с бухгалтерией. */
export const TAX_YEAR_HISTORY = 3;

/** Год, который модуль готов посчитать: от `текущий − TAX_YEAR_HISTORY` до текущего. */
export function isTaxYearInRange(year: unknown, currentYear: number): year is number {
  return (
    typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= currentYear - TAX_YEAR_HISTORY &&
    year <= currentYear
  );
}

/**
 * Параметры налогового года. Суммы — копейки; ставки и доли — сотые доли
 * процента целым (довод `ITaxSettings.rateBasisPoints`). null — значение не
 * задано: экран говорит «не задано», а не считает с нулём.
 */
export interface ITaxYearParams {
  year: number;
  /** Лимит дохода для права на УСН. */
  usnIncomeLimitKopecks: number | null;
  /** Порог дохода, выше которого на УСН появляется НДС. */
  vatThresholdKopecks: number | null;
  /** Фиксированные страховые взносы ИП за себя. */
  insuranceFixedKopecks: number | null;
  /** Предел взноса 1 % с дохода свыше 300 тыс. ₽. */
  insuranceExtraCapKopecks: number | null;
  /** Доля налога, на которую взносы уменьшают его при работниках (5000 = 50 %). */
  reductionLimitWithStaffBasisPoints: number | null;
  /** Предельные ставки УСН года. */
  maxRateUsnIncomeBasisPoints: number | null;
  maxRateUsnIncomeMinusExpensesBasisPoints: number | null;
  /** Откуда цифры и сверены ли — справка для админа и продавца. */
  sourceNote: string | null;
}

/** Поля строки года в порядке экрана — одна таблица на админку и CRM. */
export const TAX_YEAR_PARAM_LABELS: Record<
  Exclude<keyof ITaxYearParams, 'year' | 'sourceNote'>,
  string
> = {
  usnIncomeLimitKopecks: 'Лимит дохода УСН',
  vatThresholdKopecks: 'Порог НДС на УСН',
  insuranceFixedKopecks: 'Фиксированные взносы ИП',
  insuranceExtraCapKopecks: 'Предел взноса 1 %',
  reductionLimitWithStaffBasisPoints: 'Уменьшение налога при работниках, не больше',
  maxRateUsnIncomeBasisPoints: 'Предельная ставка УСН «Доходы»',
  maxRateUsnIncomeMinusExpensesBasisPoints: 'Предельная ставка УСН «Доходы минус расходы»',
};

const MONEY_PARAMS = [
  'usnIncomeLimitKopecks',
  'vatThresholdKopecks',
  'insuranceFixedKopecks',
  'insuranceExtraCapKopecks',
] as const;
const SHARE_PARAMS = [
  'reductionLimitWithStaffBasisPoints',
  'maxRateUsnIncomeBasisPoints',
  'maxRateUsnIncomeMinusExpensesBasisPoints',
] as const;

/** Потолок суммы параметра — триллион рублей: опечатка, а не закон. */
const MAX_PARAM_KOPECKS = 100_000_000_000_000;
export const MAX_TAX_YEAR_NOTE_LENGTH = 500;
/** Годы, которые вообще можно завести в таблицу. */
export const MIN_TAX_YEAR = 2020;
export const MAX_TAX_YEAR = 2100;

type TResult<V, F extends string> = { ok: true; value: V } | { ok: false; field: F; error: string };

export type TTaxYearParamField = keyof ITaxYearParams;

/**
 * Ввод строки года (админка). Пусто/null — «не задано»; суммы — рубли
 * (`toKopecks`), доли — проценты («50», «4,5»).
 */
export function validateTaxYearParamsInput(
  year: number,
  input: Record<string, unknown>,
): TResult<ITaxYearParams, TTaxYearParamField> {
  if (!Number.isInteger(year) || year < MIN_TAX_YEAR || year > MAX_TAX_YEAR) {
    return { ok: false, field: 'year', error: `Год — от ${MIN_TAX_YEAR} до ${MAX_TAX_YEAR}` };
  }
  const value: ITaxYearParams = {
    year,
    usnIncomeLimitKopecks: null,
    vatThresholdKopecks: null,
    insuranceFixedKopecks: null,
    insuranceExtraCapKopecks: null,
    reductionLimitWithStaffBasisPoints: null,
    maxRateUsnIncomeBasisPoints: null,
    maxRateUsnIncomeMinusExpensesBasisPoints: null,
    sourceNote: null,
  };
  const empty = (raw: unknown) => raw === undefined || raw === null || raw === '';

  for (const field of MONEY_PARAMS) {
    const raw = input[field];
    if (empty(raw)) continue;
    const kopecks = toKopecks(raw);
    if (kopecks === null || kopecks < 0 || kopecks > MAX_PARAM_KOPECKS) {
      return { ok: false, field, error: 'Сумма — неотрицательное число рублей' };
    }
    value[field] = kopecks;
  }
  for (const field of SHARE_PARAMS) {
    const raw = input[field];
    if (empty(raw)) continue;
    const basisPoints = sharePercent(raw);
    if (basisPoints === null || basisPoints > 10_000) {
      return { ok: false, field, error: 'Проценты — от 0 до 100, до двух знаков после запятой' };
    }
    value[field] = basisPoints;
  }
  const note = input.sourceNote;
  if (!empty(note)) {
    if (typeof note !== 'string')
      return { ok: false, field: 'sourceNote', error: 'Справка — текст' };
    if (note.trim().length > MAX_TAX_YEAR_NOTE_LENGTH) {
      return {
        ok: false,
        field: 'sourceNote',
        error: `Справка длиннее ${MAX_TAX_YEAR_NOTE_LENGTH} символов`,
      };
    }
    value.sourceNote = note.trim() || null;
  }
  return { ok: true, value };
}

/** «50», «4,5», 6.5 → сотые доли процента. Мусор → null. */
function sharePercent(raw: unknown): number | null {
  let text = '';
  if (typeof raw === 'number' && Number.isFinite(raw)) text = String(raw);
  if (typeof raw === 'string')
    text = raw.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * Уменьшение налога, внесённое руками: фиксированные взносы, взнос 1 % и
 * прочее (больничные за счёт работодателя, торговый сбор). Уменьшает только
 * УСН «Доходы»; в «Доходы минус расходы» взносы — расход, их место в «Расходах».
 */
export const TAX_REDUCTION_KINDS = ['insurance_fixed', 'insurance_extra', 'other'] as const;
export type TTaxReductionKind = (typeof TAX_REDUCTION_KINDS)[number];

export const TAX_REDUCTION_KIND_LABELS: Record<TTaxReductionKind, string> = {
  insurance_fixed: 'Фиксированные взносы ИП',
  insurance_extra: 'Взнос 1 % с дохода свыше 300 тыс. ₽',
  other: 'Прочее уменьшение',
};

export function isTaxReductionKind(value: unknown): value is TTaxReductionKind {
  return typeof value === 'string' && (TAX_REDUCTION_KINDS as readonly string[]).includes(value);
}

export interface ITaxReductionValue {
  /** ГГГГ-ММ-ДД — день уплаты взноса: уменьшает налог периода, в котором уплачен. */
  paidDay: string;
  kind: TTaxReductionKind;
  amountKopecks: number;
  note: string | null;
}

export const MAX_TAX_REDUCTION_NOTE_LENGTH = 200;

export type TTaxReductionField = 'paidDay' | 'kind' | 'amount' | 'note';

function noteOf(
  raw: unknown,
  max: number,
): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Комментарий — текст' };
  const trimmed = raw.trim();
  if (trimmed.length > max) return { ok: false, error: `Комментарий длиннее ${max} символов` };
  return { ok: true, note: trimmed || null };
}

export function validateTaxReductionInput(
  input: Record<string, unknown>,
): TResult<ITaxReductionValue, TTaxReductionField> {
  const { paidDay, kind } = input;
  if (!isIsoDay(paidDay)) return { ok: false, field: 'paidDay', error: 'Укажите дату уплаты' };
  if (!isTaxReductionKind(kind))
    return { ok: false, field: 'kind', error: 'Выберите вид уменьшения' };
  const kopecks = toKopecks(input.amount);
  if (kopecks === null) {
    return { ok: false, field: 'amount', error: 'Сумма — число в рублях, например 57390' };
  }
  if (kopecks <= 0) return { ok: false, field: 'amount', error: 'Сумма должна быть больше нуля' };
  if (kopecks > MAX_EXPENSE_KOPECKS)
    return { ok: false, field: 'amount', error: 'Слишком большая сумма' };
  const note = noteOf(input.note, MAX_TAX_REDUCTION_NOTE_LENGTH);
  if (note.ok === false) return { ok: false, field: 'note', error: note.error };
  return { ok: true, value: { paidDay, kind, amountKopecks: kopecks, note: note.note } };
}

/**
 * Ручная сверка периода с бухгалтерией: что насчитал бухгалтер и отметка
 * «сверено». Суммы бухгалтера необязательны — отметить можно и без них.
 */
export interface ITaxReconciliationValue {
  accountantIncomeKopecks: number | null;
  accountantTaxKopecks: number | null;
  checked: boolean;
  note: string | null;
}

export type TTaxReconciliationField = 'accountantIncome' | 'accountantTax' | 'checked' | 'note';

export const MAX_TAX_RECONCILIATION_NOTE_LENGTH = 500;

export function validateTaxReconciliationInput(
  input: Record<string, unknown>,
): TResult<ITaxReconciliationValue, TTaxReconciliationField> {
  const amount = (raw: unknown): number | null | 'bad' => {
    if (raw === undefined || raw === null || raw === '') return null;
    const kopecks = toKopecks(raw);
    return kopecks === null || kopecks < 0 || kopecks > MAX_PARAM_KOPECKS ? 'bad' : kopecks;
  };
  const income = amount(input.accountantIncome);
  if (income === 'bad') {
    return { ok: false, field: 'accountantIncome', error: 'Доход — неотрицательное число рублей' };
  }
  const tax = amount(input.accountantTax);
  if (tax === 'bad') {
    return { ok: false, field: 'accountantTax', error: 'Налог — неотрицательное число рублей' };
  }
  if (typeof input.checked !== 'boolean') {
    return { ok: false, field: 'checked', error: 'Отметка «сверено» — да или нет' };
  }
  const note = noteOf(input.note, MAX_TAX_RECONCILIATION_NOTE_LENGTH);
  if (note.ok === false) return { ok: false, field: 'note', error: note.error };
  return {
    ok: true,
    value: {
      accountantIncomeKopecks: income,
      accountantTaxKopecks: tax,
      checked: input.checked,
      note: note.note,
    },
  };
}
